import { Context, Effect, Layer, Schema } from "effect"
import {
    AppProcess,
    type ProcessError,
    ProcessResult,
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

export class GitHubCommandError extends Schema.TaggedErrorClass<GitHubCommandError>()(
    "GitHubCommandError",
    {
        command: Schema.String,
        result: ProcessResult,
    },
) {
    override get message() {
        return this.result.stderr || this.result.stdout || "gh command failed"
    }
}

const GitHubDecodeOperation = Schema.Literals([
    "repository",
    "pull-requests",
    "comments",
])

const GitHubComments = Schema.Array(
    Schema.Struct({
        id: Schema.Number,
        body: Schema.NullOr(Schema.String),
    }),
)

export type GitHubDecodeOperation = typeof GitHubDecodeOperation.Type

export class GitHubDecodeError extends Schema.TaggedErrorClass<GitHubDecodeError>()(
    "GitHubDecodeError",
    {
        operation: GitHubDecodeOperation,
        output: Schema.String,
        cause: Schema.Defect(),
    },
) {
    override get message() {
        return `Invalid gh ${this.operation} response`
    }
}

export type GitHubError = GitHubCommandError | GitHubDecodeError | ProcessError

export interface GitHubService {
    readonly listPullRequestsByHead: (
        heads: readonly string[],
        options: GitHubReadOptions & { readonly includeClosed?: boolean },
    ) => Effect.Effect<Map<string, GitHubPullRequestSummary>, GitHubError>
    readonly prCreate: (
        input: { readonly head: string; readonly base: string },
        options: GitHubOperationOptions,
    ) => Effect.Effect<GitHubOperationResult, GitHubError>
    readonly prEditBase: (
        prNumber: number,
        base: string,
        options: GitHubOperationOptions,
    ) => Effect.Effect<GitHubOperationResult, GitHubError>
    readonly prClose: (
        prNumber: number,
        options: GitHubOperationOptions,
    ) => Effect.Effect<GitHubOperationResult, GitHubError>
    readonly upsertStackComment: (
        prNumber: number,
        body: string,
        options: GitHubOperationOptions,
    ) => Effect.Effect<GitHubOperationResult, GitHubError>
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
    ) => Effect.Effect<GitHubOperationResult, GitHubError>
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

const decodeGitHubOutput = Effect.fn("GitHub.decodeOutput")(
    <A>(
        operation: GitHubDecodeOperation,
        output: string,
        decode: () => A,
    ): Effect.Effect<A, GitHubDecodeError> =>
        Effect.try({
            try: decode,
            catch: (cause) =>
                new GitHubDecodeError({ operation, output, cause }),
        }),
)

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

        const run = Effect.fn("GitHub.run")(function* (
            args: readonly string[],
            options: GitHubOperationOptions,
            runOptions: { readonly stdin?: string } = {},
        ) {
            const result = yield* runRaw(args, options, runOptions)
            if (result.exitCode !== 0) {
                return yield* new GitHubCommandError({
                    command: result.command,
                    result,
                })
            }
            return result
        })

        const output = Effect.fn("GitHub.output")(function* (
            args: readonly string[],
            options: GitHubReadOptions,
            stdin?: string,
        ) {
            const result = yield* run(args, options, { stdin })
            return result.stdout
        })

        const resolveRepository = Effect.fn("GitHub.resolveRepository")(
            function* (options: GitHubReadOptions) {
                const originUrl = yield* git.originRemoteUrl(options)
                const originRepository = originUrl
                    ? parseGitHubRemoteUrl(originUrl)
                    : undefined
                if (originRepository) return originRepository
                const stdout = yield* output(
                    ["repo", "view", "--json", "owner,name"],
                    options,
                )
                return yield* decodeGitHubOutput("repository", stdout, () =>
                    parseGhRepositoryJson(stdout),
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
                    return yield* decodeGitHubOutput(
                        "pull-requests",
                        stdout,
                        () =>
                            options.includeClosed
                                ? parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(
                                      stdout,
                                  )
                                : parseGhPullRequestsByHeadGraphqlJson(stdout),
                    )
                },
            ),
            prCreate: Effect.fn("GitHub.prCreate")(function* (input, options) {
                const args = yield* withResolvedRepository(
                    [
                        "pr",
                        "create",
                        "--head",
                        input.head,
                        "--base",
                        input.base,
                        "--fill",
                    ],
                    options,
                )
                return yield* run(args, options)
            }),
            prEditBase: Effect.fn("GitHub.prEditBase")(
                function* (prNumber, base, options) {
                    const args = yield* withResolvedRepository(
                        ["pr", "edit", String(prNumber), "--base", base],
                        options,
                    )
                    return yield* run(args, options)
                },
            ),
            prClose: Effect.fn("GitHub.prClose")(function* (prNumber, options) {
                const args = yield* withResolvedRepository(
                    ["pr", "close", String(prNumber)],
                    options,
                )
                return yield* run(args, options)
            }),
            upsertStackComment: Effect.fn("GitHub.upsertStackComment")(
                function* (prNumber, body, options) {
                    const repository = yield* resolveRepository(options)
                    const marker = `<!-- kajji-stack pr=${prNumber} -->`
                    const stdout = yield* output(
                        [
                            "api",
                            `repos/${repository.owner}/${repository.name}/issues/${prNumber}/comments`,
                        ],
                        options,
                    )
                    const comments = yield* decodeGitHubOutput(
                        "comments",
                        stdout,
                        () =>
                            Schema.decodeUnknownSync(GitHubComments)(
                                JSON.parse(stdout),
                            ),
                    )
                    const existing = comments.find((comment) =>
                        comment.body?.includes(marker),
                    )
                    const existingId = existing?.id
                    const path =
                        typeof existingId === "number"
                            ? `repos/${repository.owner}/${repository.name}/issues/comments/${existingId}`
                            : `repos/${repository.owner}/${repository.name}/issues/${prNumber}/comments`
                    return yield* run(
                        [
                            "api",
                            "--silent",
                            "--method",
                            typeof existingId === "number" ? "PATCH" : "POST",
                            path,
                            "-f",
                            `body=${body}`,
                        ],
                        options,
                    )
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
