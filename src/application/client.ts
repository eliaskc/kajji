import { Effect, Layer, ManagedRuntime } from "effect"
import type { Bookmark } from "../commander/bookmarks"
import {
    Jj,
    type JjBookmarkCreateOptions,
    type JjBookmarkReadOptions,
    type JjBookmarkSetOptions,
    type JjCommandError,
    type JjCommitDetails,
    type JjDescription,
    type JjDiffOptions,
    type JjDiffTarget,
    type JjEditOptions,
    type JjGitFetchOptions,
    type JjGitPushOptions,
    JjLive,
    type JjLogReadOptions,
    type JjOperationOptions,
    type JjOperationResult,
    type JjRebaseOptions,
    type JjRefreshState,
    type JjService,
    type JjSquashOptions,
    type OperationFailure,
    type OperationSink,
} from "../commander/jj"
import type { FetchLogPageResult } from "../commander/log"
import type { CommandObserver } from "../commander/observer"
import type { OperationResult } from "../commander/operations"
import type { FileChange } from "../commander/types"
import { AppProcessLive, type ProcessError } from "../process/app-process"
import { diagnosticsLog } from "../utils/diagnostics"
import { makeHistoricalFileStore } from "./historical-files"

interface ApplicationOperationOptions extends Omit<JjOperationOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationReadOptions extends Omit<JjOperationOptions, "sink"> {
    readonly signal?: AbortSignal
}

interface ApplicationDiffOptions extends Omit<JjDiffOptions, "sink"> {
    readonly signal?: AbortSignal
}

interface ApplicationBookmarkReadOptions
    extends Omit<JjBookmarkReadOptions, "sink"> {
    readonly signal?: AbortSignal
}

interface ApplicationLogReadOptions extends Omit<JjLogReadOptions, "sink"> {
    readonly signal?: AbortSignal
}

export interface ApplicationGitFetchOptions
    extends Omit<JjGitFetchOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

export interface ApplicationGitPushOptions
    extends Omit<JjGitPushOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationEditOptions extends Omit<JjEditOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationSquashOptions extends Omit<JjSquashOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationRebaseOptions extends Omit<JjRebaseOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationBookmarkCreateOptions
    extends Omit<JjBookmarkCreateOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationBookmarkSetOptions
    extends Omit<JjBookmarkSetOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

export interface ApplicationClient {
    readonly jjGitFetch: (
        options: ApplicationGitFetchOptions,
    ) => Promise<OperationResult>
    readonly jjGitPush: (
        options: ApplicationGitPushOptions,
    ) => Promise<OperationResult>
    readonly jjUndo: (
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjRedo: (
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjOpRestore: (
        operationId: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjWorkspaceUpdateStale: (
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjEdit: (
        revision: string,
        options: ApplicationEditOptions,
    ) => Promise<OperationResult>
    readonly jjDescribe: (
        revision: string,
        message: string,
        options: ApplicationEditOptions,
    ) => Promise<OperationResult>
    readonly jjSquash: (
        revision: string | undefined,
        options: ApplicationSquashOptions,
    ) => Promise<OperationResult>
    readonly jjRebase: (
        revision: string,
        destination: string,
        options: ApplicationRebaseOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkCreate: (
        name: string,
        options: ApplicationBookmarkCreateOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkSet: (
        name: string,
        revision: string,
        options: ApplicationBookmarkSetOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkDelete: (
        name: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkRename: (
        oldName: string,
        newName: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkForget: (
        name: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjDuplicate: (
        revision: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjAbandon: (
        revision: string,
        options: ApplicationEditOptions,
    ) => Promise<OperationResult>
    readonly jjRestore: (
        paths: readonly string[],
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjMaterializeFiles: (
        revision: string,
        paths: readonly string[],
        options: ApplicationReadOptions,
    ) => Promise<string[]>
    readonly jjIsInTrunk: (
        revision: string,
        options: ApplicationReadOptions,
    ) => Promise<boolean>
    readonly jjShowDescription: (
        revision: string,
        options: ApplicationReadOptions,
    ) => Promise<JjDescription>
    readonly jjNearestAncestorBookmarkNames: (
        revision: string,
        options: ApplicationReadOptions,
    ) => Promise<string[]>
    readonly jjRefreshState: (
        options: ApplicationReadOptions,
    ) => Promise<JjRefreshState>
    readonly jjFiles: (
        target: JjDiffTarget,
        options: ApplicationReadOptions,
    ) => Promise<FileChange[]>
    readonly jjCommitDetails: (
        revision: string,
        options: ApplicationReadOptions,
    ) => Promise<JjCommitDetails>
    readonly jjOpLog: (
        limit: number | undefined,
        options: ApplicationReadOptions,
    ) => Promise<string[]>
    readonly jjDiff: (
        target: JjDiffTarget,
        options: ApplicationDiffOptions,
    ) => Promise<string>
    readonly jjBookmarks: (
        options: ApplicationBookmarkReadOptions,
    ) => Promise<Bookmark[]>
    readonly jjLogPage: (
        options: ApplicationLogReadOptions,
    ) => Promise<FetchLogPageResult>
    readonly dispose: () => Promise<void>
}

export class ApplicationClientClosedError extends Error {
    constructor() {
        super("The application runtime is shutting down")
        this.name = "ApplicationClientClosedError"
    }
}

function errorMessage(error: OperationFailure): string {
    if (error._tag === "ProcessTimeoutError") {
        return `Command timed out after ${error.timeoutMs}ms`
    }
    if (error._tag === "OperationInterruptedError") return "Command cancelled"
    const cause = error.cause
    return cause instanceof Error ? cause.message : String(cause)
}

function observerSink(observer: CommandObserver | undefined): {
    readonly sink: OperationSink
    readonly wasLogged: () => boolean
} {
    let logId: string | undefined
    return {
        sink: {
            start: (command) => {
                logId = observer?.start(command, { kind: "jj" })
            },
            output: (_stream, chunk) => {
                if (logId) observer?.append(logId, chunk)
            },
            finish: (result) => {
                if (!logId) return
                observer?.finish(logId, {
                    ...result,
                    success: result.exitCode === 0,
                    logged: true,
                })
            },
            fail: (error) => {
                if (!logId) return
                observer?.finish(logId, {
                    stdout: "",
                    stderr: errorMessage(error),
                    exitCode: -1,
                    success: false,
                    logged: true,
                })
            },
        },
        wasLogged: () => Boolean(logId),
    }
}

export function makeApplicationClient(
    appProcessLayer = AppProcessLive,
): ApplicationClient {
    const layer = JjLive.pipe(Layer.provide(appProcessLayer))
    const runtime = ManagedRuntime.make(layer)
    const historicalFiles = makeHistoricalFileStore()
    let accepting = true
    let disposePromise: Promise<void> | undefined

    const runRead = <A, E>(
        options: ApplicationReadOptions,
        operation: (jj: JjService) => Effect.Effect<A, E>,
    ): Promise<A> => {
        if (!accepting)
            return Promise.reject(new ApplicationClientClosedError())
        return runtime.runPromise(Jj.use(operation), { signal: options.signal })
    }

    const runOperation = async (
        options: ApplicationOperationOptions,
        operation: (
            jj: JjService,
            sink: OperationSink,
        ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>,
    ): Promise<OperationResult> => {
        if (!accepting) throw new ApplicationClientClosedError()
        const { observer, signal, ...runOptions } = options
        const { sink, wasLogged } = observerSink(observer)
        const startedAt = performance.now()
        const effect = Jj.use((jj) =>
            operation(jj, sink).pipe(
                Effect.catchTag("JjCommandError", (error) =>
                    Effect.succeed({
                        ...error.result,
                        command: error.command,
                    }),
                ),
            ),
        )
        const result = await runtime.runPromise(effect, { signal })
        const success = result.exitCode === 0
        diagnosticsLog(success ? "info" : "error", "jj command finished", {
            command: result.command,
            cwd: runOptions.cwd,
            durationMs: Math.round(performance.now() - startedAt),
            exitCode: result.exitCode,
            ...(result.stderr ? { stderr: result.stderr.slice(0, 4000) } : {}),
        })
        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            success,
            logged: wasLogged(),
            command: result.command,
        }
    }

    return {
        jjGitFetch: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.gitFetch({ ...options, sink }),
            ),
        jjGitPush: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.gitPush({ ...options, sink }),
            ),
        jjUndo: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.undo({ ...options, sink }),
            ),
        jjRedo: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.redo({ ...options, sink }),
            ),
        jjOpRestore: (operationId, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.opRestore(operationId, { ...options, sink }),
            ),
        jjWorkspaceUpdateStale: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.workspaceUpdateStale({ ...options, sink }),
            ),
        jjEdit: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.edit(revision, { ...options, sink }),
            ),
        jjDescribe: (revision, message, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.describe(revision, message, { ...options, sink }),
            ),
        jjSquash: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.squash(revision, { ...options, sink }),
            ),
        jjRebase: (revision, destination, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.rebase(revision, destination, { ...options, sink }),
            ),
        jjBookmarkCreate: (name, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkCreate(name, { ...options, sink }),
            ),
        jjBookmarkSet: (name, revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkSet(name, revision, { ...options, sink }),
            ),
        jjBookmarkDelete: (name, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkDelete(name, { ...options, sink }),
            ),
        jjBookmarkRename: (
            oldName,
            newName,
            { observer, signal, ...options },
        ) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkRename(oldName, newName, { ...options, sink }),
            ),
        jjBookmarkForget: (name, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkForget(name, { ...options, sink }),
            ),
        jjDuplicate: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.duplicate(revision, { ...options, sink }),
            ),
        jjAbandon: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.abandon(revision, { ...options, sink }),
            ),
        jjRestore: (paths, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.restore(paths, { ...options, sink }),
            ),
        jjMaterializeFiles: (revision, paths, options) => {
            if (!accepting) {
                return Promise.reject(new ApplicationClientClosedError())
            }
            return historicalFiles.materialize(
                revision,
                paths,
                (selectedRevision, path, outputPath) =>
                    runRead(options, (jj) =>
                        jj.materializeFile(selectedRevision, path, outputPath, {
                            cwd: options.cwd,
                            timeoutMs: options.timeoutMs,
                        }),
                    ),
            )
        },
        jjIsInTrunk: (revision, options) =>
            runRead(options, (jj) =>
                jj.isInTrunk(revision, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjShowDescription: (revision, options) =>
            runRead(options, (jj) =>
                jj.showDescription(revision, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjNearestAncestorBookmarkNames: (revision, options) =>
            runRead(options, (jj) =>
                jj.nearestAncestorBookmarkNames(revision, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjRefreshState: (options) =>
            runRead(options, (jj) =>
                jj.refreshState({
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjFiles: (target, options) =>
            runRead(options, (jj) =>
                jj.files(target, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjCommitDetails: (revision, options) =>
            runRead(options, (jj) =>
                jj.commitDetails(revision, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjOpLog: (limit, options) =>
            runRead(options, (jj) =>
                jj.opLog(limit, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjDiff: (target, options) =>
            runRead(options, (jj) => jj.diff(target, options)),
        jjBookmarks: (options) =>
            runRead(options, (jj) => jj.bookmarks(options)),
        jjLogPage: (options) => runRead(options, (jj) => jj.logPage(options)),
        dispose: () => {
            accepting = false
            if (!disposePromise) {
                disposePromise = runtime
                    .dispose()
                    .finally(() => historicalFiles.dispose())
            }
            return disposePromise
        },
    }
}
