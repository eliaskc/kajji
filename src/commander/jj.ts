import { Context, Data, Effect, Layer } from "effect"
import {
    AppProcess,
    type ProcessError,
    type ProcessOutputStream,
    type ProcessResult,
} from "../process/app-process"

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

        const run = Effect.fn("Jj.run")(function* (
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
            if (result.exitCode !== 0) {
                return yield* new JjCommandError({ command, result })
            }
            return { ...result, command }
        })

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
        })
    }),
)
