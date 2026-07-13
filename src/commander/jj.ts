import { Context, Data, Effect, Layer } from "effect"
import {
    AppProcess,
    type ProcessError,
    type ProcessOutputStream,
    type ProcessResult,
} from "../process/app-process"
import { isStaleWorkingCopyError } from "../utils/error-parser"

export class OperationInterruptedError extends Data.TaggedError(
    "OperationInterruptedError",
)<{
    readonly command: string
}> {}

export type OperationFailure = ProcessError | OperationInterruptedError

export interface OperationSink {
    readonly start: (command: string) => void
    readonly output: (stream: ProcessOutputStream, chunk: string) => void
    readonly finish: (result: ProcessResult) => void
    readonly fail: (error: OperationFailure) => void
}

export interface JjOperationOptions {
    readonly cwd: string
    readonly timeoutMs?: number
    readonly sink?: OperationSink
}

export interface JjGitFetchOptions extends JjOperationOptions {
    readonly allRemotes?: boolean
    readonly tracked?: boolean
    readonly branches?: readonly string[]
    readonly remotes?: readonly string[]
}

export interface JjGitPushOptions extends JjOperationOptions {
    readonly remote?: string
    readonly bookmarks?: readonly string[]
    readonly all?: boolean
    readonly tracked?: boolean
    readonly deleted?: boolean
    readonly allowEmptyDescription?: boolean
    readonly allowPrivate?: boolean
    readonly revisions?: readonly string[]
    readonly changes?: readonly string[]
    readonly dryRun?: boolean
}

export interface JjEditOptions extends JjOperationOptions {
    readonly ignoreImmutable?: boolean
}

export interface JjSquashOptions extends JjOperationOptions {
    readonly into?: string
    readonly useDestinationMessage?: boolean
    readonly keepEmptied?: boolean
    readonly ignoreImmutable?: boolean
}

export interface JjRebaseOptions extends JjOperationOptions {
    readonly mode?: "revision" | "descendants" | "branch"
    readonly targetMode?: "onto" | "insertAfter" | "insertBefore"
    readonly skipEmptied?: boolean
    readonly ignoreImmutable?: boolean
}

export interface JjBookmarkCreateOptions extends JjOperationOptions {
    readonly revision?: string
}

export interface JjBookmarkSetOptions extends JjOperationOptions {
    readonly allowBackwards?: boolean
}

export interface JjOperationResult extends ProcessResult {
    readonly command: string
}

export interface JjDescription {
    readonly subject: string
    readonly body: string
}

export interface JjRefreshState {
    readonly operationId: string
    readonly workingCopyCommitId: string
}

export class JjStaleWorkingCopyError extends Data.TaggedError(
    "JjStaleWorkingCopyError",
)<{
    readonly output: string
}> {
    override get message() {
        return `The working copy is stale\n${this.output}`
    }
}

export class JjCommandError extends Data.TaggedError("JjCommandError")<{
    readonly command: string
    readonly result: ProcessResult
}> {}

export interface JjService {
    readonly gitFetch: (
        options: JjGitFetchOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly gitPush: (
        options: JjGitPushOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly undo: (
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly redo: (
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly opRestore: (
        operationId: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly workspaceUpdateStale: (
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly edit: (
        revision: string,
        options: JjEditOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly describe: (
        revision: string,
        message: string,
        options: JjEditOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly squash: (
        revision: string | undefined,
        options: JjSquashOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly rebase: (
        revision: string,
        destination: string,
        options: JjRebaseOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkCreate: (
        name: string,
        options: JjBookmarkCreateOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkSet: (
        name: string,
        revision: string,
        options: JjBookmarkSetOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkDelete: (
        name: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkRename: (
        oldName: string,
        newName: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkForget: (
        name: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly duplicate: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly abandon: (
        revision: string,
        options: JjEditOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly restore: (
        paths: readonly string[],
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly isInTrunk: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<boolean, ProcessError>
    readonly showDescription: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjDescription, ProcessError>
    readonly nearestAncestorBookmarkNames: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<string[], JjCommandError | ProcessError>
    readonly refreshState: (
        options: JjOperationOptions,
    ) => Effect.Effect<JjRefreshState, JjStaleWorkingCopyError | ProcessError>
}

export class Jj extends Context.Service<Jj, JjService>()("kajji/Jj") {}

function notify(fn: () => void) {
    try {
        fn()
    } catch {
        // Operation observation must never affect the command.
    }
}

export function makeGitFetchArgs(
    options: Omit<JjGitFetchOptions, keyof JjOperationOptions>,
): string[] {
    const args = ["git", "fetch"]
    for (const branch of options.branches ?? []) {
        args.push("--branch", branch)
    }
    if (options.tracked) args.push("--tracked")
    for (const remote of options.remotes ?? []) {
        args.push("--remote", remote)
    }
    if (options.allRemotes) args.push("--all-remotes")
    return args
}

export function makeGitPushArgs(
    options: Omit<JjGitPushOptions, keyof JjOperationOptions>,
): string[] {
    const args = ["git", "push"]
    if (options.remote) args.push("--remote", options.remote)
    for (const bookmark of options.bookmarks ?? []) {
        args.push("--bookmark", bookmark)
    }
    if (options.all) args.push("--all")
    if (options.tracked) args.push("--tracked")
    if (options.deleted) args.push("--deleted")
    if (options.allowEmptyDescription) args.push("--allow-empty-description")
    if (options.allowPrivate) args.push("--allow-private")
    for (const revision of options.revisions ?? []) {
        args.push("--revisions", revision)
    }
    for (const change of options.changes ?? []) {
        args.push("--change", change)
    }
    if (options.dryRun) args.push("--dry-run")
    return args
}

export const JjLive = Layer.effect(
    Jj,
    Effect.gen(function* () {
        const appProcess = yield* AppProcess

        const runRaw = Effect.fn("Jj.runRaw")(function* (
            args: readonly string[],
            options: JjOperationOptions,
            displayCommand = `jj ${args.join(" ")}`,
        ) {
            const command = displayCommand
            notify(() => options.sink?.start(command))

            const processCommand = {
                executable: "jj",
                args,
                cwd: options.cwd,
                env: {
                    JJ_EDITOR: "true",
                    EDITOR: "true",
                    VISUAL: "true",
                },
                timeoutMs: options.timeoutMs,
                onOutput: (stream: ProcessOutputStream, chunk: string) =>
                    notify(() => options.sink?.output(stream, chunk)),
            }
            const result = yield* appProcess.run(processCommand).pipe(
                Effect.tapError((error) =>
                    Effect.sync(() => notify(() => options.sink?.fail(error))),
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

        const run = Effect.fn("Jj.run")(function* (
            args: readonly string[],
            options: JjOperationOptions,
            displayCommand?: string,
        ) {
            const result = yield* runRaw(args, options, displayCommand)
            if (result.exitCode !== 0) {
                return yield* new JjCommandError({
                    command: result.command,
                    result,
                })
            }
            return result
        })

        const throwIfStale = (result: JjOperationResult) => {
            const output = result.stdout + result.stderr
            if (isStaleWorkingCopyError(output)) {
                return Effect.fail(new JjStaleWorkingCopyError({ output }))
            }
            return Effect.void
        }

        const readOpLogId = Effect.fn("Jj.opLogId")(function* (
            options: JjOperationOptions,
        ) {
            const result = yield* runRaw(
                [
                    "op",
                    "log",
                    "--limit",
                    "1",
                    "--no-graph",
                    "--ignore-working-copy",
                    "-T",
                    "self.id()",
                ],
                options,
            )
            yield* throwIfStale(result)
            return result.exitCode === 0 ? result.stdout.trim() : ""
        })

        const readWorkingCopyCommitId = Effect.fn("Jj.workingCopyCommitId")(
            function* (options: JjOperationOptions) {
                const result = yield* runRaw(
                    [
                        "log",
                        "--limit",
                        "1",
                        "--no-graph",
                        "-r",
                        "@",
                        "-T",
                        "commit_id",
                    ],
                    options,
                )
                yield* throwIfStale(result)
                return result.exitCode === 0
                    ? result.stdout
                          .replace(
                              // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence
                              /\x1b\[[0-9;]*m/g,
                              "",
                          )
                          .trim()
                    : ""
            },
        )

        return Jj.of({
            gitFetch: Effect.fn("Jj.gitFetch")((options: JjGitFetchOptions) =>
                run(makeGitFetchArgs(options), options),
            ),
            gitPush: Effect.fn("Jj.gitPush")((options: JjGitPushOptions) =>
                run(makeGitPushArgs(options), options),
            ),
            undo: Effect.fn("Jj.undo")((options: JjOperationOptions) =>
                run(["undo"], options),
            ),
            redo: Effect.fn("Jj.redo")((options: JjOperationOptions) =>
                run(["redo"], options),
            ),
            opRestore: Effect.fn("Jj.opRestore")(
                (operationId: string, options: JjOperationOptions) =>
                    run(["op", "restore", operationId], options),
            ),
            workspaceUpdateStale: Effect.fn("Jj.workspaceUpdateStale")(
                (options: JjOperationOptions) =>
                    run(["workspace", "update-stale"], options),
            ),
            edit: Effect.fn("Jj.edit")(
                (revision: string, options: JjEditOptions) =>
                    run(
                        [
                            "edit",
                            revision,
                            ...(options.ignoreImmutable
                                ? ["--ignore-immutable"]
                                : []),
                        ],
                        options,
                    ),
            ),
            describe: Effect.fn("Jj.describe")(
                (revision: string, message: string, options: JjEditOptions) =>
                    run(
                        [
                            "describe",
                            revision,
                            "-m",
                            message,
                            ...(options.ignoreImmutable
                                ? ["--ignore-immutable"]
                                : []),
                        ],
                        options,
                        `jj describe ${revision} -m "..."`,
                    ),
            ),
            squash: Effect.fn("Jj.squash")(
                (revision: string | undefined, options: JjSquashOptions) => {
                    const args = ["squash"]
                    if (options.into) {
                        if (revision) args.push("--from", revision)
                        args.push("--into", options.into)
                    } else if (revision) {
                        args.push("-r", revision)
                    }
                    if (options.useDestinationMessage) args.push("-u")
                    if (options.keepEmptied) args.push("-k")
                    if (options.ignoreImmutable) args.push("--ignore-immutable")
                    return run(args, options)
                },
            ),
            rebase: Effect.fn("Jj.rebase")(
                (
                    revision: string,
                    destination: string,
                    options: JjRebaseOptions,
                ) => {
                    const args = ["rebase"]
                    if (options.mode === "descendants")
                        args.push("-s", revision)
                    else if (options.mode === "branch")
                        args.push("-b", revision)
                    else args.push("-r", revision)

                    if (options.targetMode === "insertAfter")
                        args.push("-A", destination)
                    else if (options.targetMode === "insertBefore")
                        args.push("-B", destination)
                    else args.push("-d", destination)

                    if (options.skipEmptied) args.push("--skip-emptied")
                    if (options.ignoreImmutable) args.push("--ignore-immutable")
                    return run(args, options)
                },
            ),
            bookmarkCreate: Effect.fn("Jj.bookmarkCreate")(
                (name: string, options: JjBookmarkCreateOptions) =>
                    run(
                        [
                            "bookmark",
                            "create",
                            name,
                            ...(options.revision
                                ? ["-r", options.revision]
                                : []),
                        ],
                        options,
                    ),
            ),
            bookmarkSet: Effect.fn("Jj.bookmarkSet")(
                (
                    name: string,
                    revision: string,
                    options: JjBookmarkSetOptions,
                ) =>
                    run(
                        [
                            "bookmark",
                            "set",
                            name,
                            "-r",
                            revision,
                            ...(options.allowBackwards
                                ? ["--allow-backwards"]
                                : []),
                        ],
                        options,
                    ),
            ),
            bookmarkDelete: Effect.fn("Jj.bookmarkDelete")(
                (name: string, options: JjOperationOptions) =>
                    run(["bookmark", "delete", name], options),
            ),
            bookmarkRename: Effect.fn("Jj.bookmarkRename")(
                (
                    oldName: string,
                    newName: string,
                    options: JjOperationOptions,
                ) => run(["bookmark", "rename", oldName, newName], options),
            ),
            bookmarkForget: Effect.fn("Jj.bookmarkForget")(
                (name: string, options: JjOperationOptions) =>
                    run(["bookmark", "forget", name], options),
            ),
            duplicate: Effect.fn("Jj.duplicate")(
                (revision: string, options: JjOperationOptions) =>
                    run(["duplicate", revision], options),
            ),
            abandon: Effect.fn("Jj.abandon")(
                (revision: string, options: JjEditOptions) =>
                    run(
                        [
                            "abandon",
                            revision,
                            ...(options.ignoreImmutable
                                ? ["--ignore-immutable"]
                                : []),
                        ],
                        options,
                    ),
            ),
            restore: Effect.fn("Jj.restore")(
                (paths: readonly string[], options: JjOperationOptions) =>
                    run(["restore", ...paths], options),
            ),
            isInTrunk: Effect.fn("Jj.isInTrunk")(function* (
                revision: string,
                options: JjOperationOptions,
            ) {
                const result = yield* runRaw(
                    [
                        "log",
                        "-r",
                        `${revision} & ::trunk()`,
                        "--no-graph",
                        "-T",
                        "change_id",
                    ],
                    options,
                )
                return result.exitCode === 0 && result.stdout.trim().length > 0
            }),
            showDescription: Effect.fn("Jj.showDescription")(function* (
                revision: string,
                options: JjOperationOptions,
            ) {
                const result = yield* runRaw(
                    ["log", "-r", revision, "--no-graph", "-T", "description"],
                    options,
                )
                if (result.exitCode !== 0) return { subject: "", body: "" }
                const lines = result.stdout.trim().split("\n")
                return {
                    subject: lines[0] ?? "",
                    body: lines.slice(1).join("\n").trim(),
                }
            }),
            nearestAncestorBookmarkNames: Effect.fn(
                "Jj.nearestAncestorBookmarkNames",
            )(function* (revision: string, options: JjOperationOptions) {
                const revset = `heads(::${revision} & bookmarks())`
                const result = yield* run(
                    [
                        "bookmark",
                        "list",
                        "-r",
                        revset,
                        "--template",
                        'name ++ "\\n"',
                    ],
                    options,
                )
                return result.stdout
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
            }),
            refreshState: Effect.fn("Jj.refreshState")(function* (
                options: JjOperationOptions,
            ) {
                const [operationId, workingCopyCommitId] = yield* Effect.all(
                    [readOpLogId(options), readWorkingCopyCommitId(options)],
                    { concurrency: "unbounded" },
                )
                return { operationId, workingCopyCommitId }
            }),
        })
    }),
)
