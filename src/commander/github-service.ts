import { Context, Data, Effect, Layer } from "effect"
import {
    AppProcess,
    type ProcessError,
    type ProcessResult,
} from "../process/app-process"
import {
    OperationInterruptedError,
    type OperationSink,
} from "../process/operation-sink"
import { Git } from "./git"
import {
    type GitHubPullRequestSummary,
    type GitHubRepository,
    parseGhPullRequestsByHeadGraphqlJson,
    parseGhPullRequestsByHeadGraphqlJsonIncludingClosed,
    parseGhRepositoryJson,
    parseGitHubRemoteUrl,
} from "./github"

export interface GitHubReadOptions {
    readonly cwd: string
    readonly timeoutMs?: number
}

export interface GitHubOperationOptions extends GitHubReadOptions {
    readonly sink?: OperationSink
}

export interface GitHubOperationResult extends ProcessResult {
    readonly command: string
}

export class GitHubCommandError extends Data.TaggedError("GitHubCommandError")<{
    readonly command: string
    readonly result: ProcessResult
}> {
    override get message() {
        return this.result.stderr || this.result.stdout || "gh command failed"
    }
}

export interface GitHubService {
    readonly listPullRequestsByHead: (
        heads: readonly string[],
        options: GitHubReadOptions & { readonly includeClosed?: boolean },
    ) => Effect.Effect<
        Map<string, GitHubPullRequestSummary>,
        GitHubCommandError | ProcessError
    >
    readonly prCreateWeb: (
        head: string,
        options: GitHubOperationOptions,
    ) => Effect.Effect<GitHubOperationResult, ProcessError>
    readonly browseCommit: (
        commit: string,
        options: GitHubOperationOptions,
    ) => Effect.Effect<GitHubOperationResult, ProcessError>
    readonly prViewWeb: (
        prNumber: number,
        options: GitHubOperationOptions,
    ) => Effect.Effect<GitHubOperationResult, GitHubCommandError | ProcessError>
}

export class GitHub extends Context.Service<GitHub, GitHubService>()(
    "kajji/GitHub",
) {}

function notify(callback: () => void) {
    try {
        callback()
    } catch {
        // Observation must not alter command execution.
    }
}

export const GitHubLive = Layer.effect(
    GitHub,
    Effect.gen(function* () {
        const appProcess = yield* AppProcess
        const git = yield* Git

        const runRaw = Effect.fn("GitHub.runRaw")(function* (
            args: readonly string[],
            options: GitHubOperationOptions,
            runOptions: { readonly stdin?: string } = {},
        ) {
            const command = `gh ${args.join(" ")}`
            notify(() => options.sink?.start(command, "shell"))
            const result = yield* appProcess
                .run({
                    executable: "gh",
                    args,
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                    stdin: runOptions.stdin,
                    onOutput: (stream, chunk) =>
                        notify(() => options.sink?.output(stream, chunk)),
                })
                .pipe(
                    Effect.tapError((error) =>
                        Effect.sync(() =>
                            notify(() => options.sink?.fail(error)),
                        ),
                    ),
                    Effect.onInterrupt(() =>
                        Effect.sync(() =>
                            notify(() =>
                                options.sink?.fail(
                                    new OperationInterruptedError({ command }),
                                ),
                            ),
                        ),
                    ),
                )
            notify(() => options.sink?.finish(result))
            return { ...result, command }
        })

        const output = Effect.fn("GitHub.output")(function* (
            args: readonly string[],
            options: GitHubReadOptions,
            stdin?: string,
        ) {
            const result = yield* runRaw(args, options, { stdin })
            if (result.exitCode !== 0) {
                return yield* new GitHubCommandError({
                    command: result.command,
                    result,
                })
            }
            return result.stdout
        })

        const resolveRepository = Effect.fn("GitHub.resolveRepository")(
            function* (options: GitHubReadOptions) {
                const originUrl = yield* git.originRemoteUrl(options)
                const originRepository = originUrl
                    ? parseGitHubRemoteUrl(originUrl)
                    : undefined
                if (originRepository) return originRepository
                return parseGhRepositoryJson(
                    yield* output(
                        ["repo", "view", "--json", "owner,name"],
                        options,
                    ),
                )
            },
        )

        const withResolvedRepository = Effect.fn(
            "GitHub.withResolvedRepository",
        )(function* (args: readonly string[], options: GitHubReadOptions) {
            const repository = yield* resolveRepository(options)
            return [
                ...args,
                "--repo",
                `${repository.owner}/${repository.name}`,
            ] as const
        })

        return GitHub.of({
            listPullRequestsByHead: Effect.fn("GitHub.listPullRequestsByHead")(
                function* (heads, options) {
                    const uniqueHeads = [...new Set(heads)].filter(Boolean)
                    if (uniqueHeads.length === 0) return new Map()

                    const repository = yield* resolveRepository(options)
                    const states = options.includeClosed
                        ? "[OPEN, CLOSED, MERGED]"
                        : "OPEN"
                    const query = `query PullRequestsByHead($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
${uniqueHeads
    .map(
        (head, index) =>
            `    h${index}: ref(qualifiedName: ${JSON.stringify(
                `refs/heads/${head}`,
            )}) { associatedPullRequests(first: 20, states: ${states}) { nodes { number headRefName baseRefName state merged updatedAt createdAt } } }
    p${index}: pullRequests(first: 20, states: ${states}, headRefName: ${JSON.stringify(
        head,
    )}) { nodes { number headRefName baseRefName state merged updatedAt createdAt } }`,
    )
    .join("\n")}
  }
}`
                    const stdout = yield* output(
                        [
                            "api",
                            "graphql",
                            "-f",
                            `owner=${repository.owner}`,
                            "-f",
                            `name=${repository.name}`,
                            "-f",
                            `query=${query}`,
                        ],
                        options,
                    )
                    return options.includeClosed
                        ? parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(
                              stdout,
                          )
                        : parseGhPullRequestsByHeadGraphqlJson(stdout)
                },
            ),
            prCreateWeb: Effect.fn("GitHub.prCreateWeb")((head, options) =>
                runRaw(["pr", "create", "--web", "--head", head], options),
            ),
            browseCommit: Effect.fn("GitHub.browseCommit")((commit, options) =>
                runRaw(["browse", commit], options),
            ),
            prViewWeb: Effect.fn("GitHub.prViewWeb")(
                function* (prNumber, options) {
                    const args = yield* withResolvedRepository(
                        ["pr", "view", String(prNumber), "--web"],
                        options,
                    )
                    return yield* runRaw(args, options)
                },
            ),
        })
    }),
) satisfies Layer.Layer<GitHub, never, AppProcess | Git>
