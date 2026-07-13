import { Effect, Layer, ManagedRuntime } from "effect"
import {
    Jj,
    type JjBookmarkCreateOptions,
    type JjBookmarkSetOptions,
    type JjCommandError,
    type JjEditOptions,
    type JjGitFetchOptions,
    type JjGitPushOptions,
    JjLive,
    type JjOperationOptions,
    type JjOperationResult,
    type JjRebaseOptions,
    type JjService,
    type JjSquashOptions,
    type OperationFailure,
    type OperationSink,
} from "../commander/jj"
import type { CommandObserver } from "../commander/observer"
import type { OperationResult } from "../commander/operations"
import { AppProcessLive, type ProcessError } from "../process/app-process"
import { diagnosticsLog } from "../utils/diagnostics"

interface ApplicationOperationOptions extends Omit<JjOperationOptions, "sink"> {
    readonly observer?: CommandObserver
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
    let accepting = true
    let disposePromise: Promise<void> | undefined

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
        dispose: () => {
            accepting = false
            if (!disposePromise) disposePromise = runtime.dispose()
            return disposePromise
        },
    }
}
