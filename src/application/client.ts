import { Effect, Layer, ManagedRuntime } from "effect"
import {
    Jj,
    type JjGitFetchOptions,
    JjLive,
    type OperationFailure,
    type OperationSink,
} from "../commander/jj"
import type { CommandObserver } from "../commander/observer"
import type { OperationResult } from "../commander/operations"
import { AppProcessLive } from "../process/app-process"
import { diagnosticsLog } from "../utils/diagnostics"

export interface ApplicationGitFetchOptions
    extends Omit<JjGitFetchOptions, "cwd" | "sink"> {
    readonly cwd: string
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

export interface ApplicationClient {
    readonly jjGitFetch: (
        options: ApplicationGitFetchOptions,
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

    return {
        jjGitFetch: async ({ observer, signal, ...options }) => {
            if (!accepting) throw new ApplicationClientClosedError()
            const { sink, wasLogged } = observerSink(observer)
            const startedAt = performance.now()
            const effect = Jj.use((jj) =>
                jj.gitFetch({ ...options, sink }).pipe(
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
                command: "jj git fetch",
                cwd: options.cwd,
                durationMs: Math.round(performance.now() - startedAt),
                exitCode: result.exitCode,
                ...(result.stderr
                    ? { stderr: result.stderr.slice(0, 4000) }
                    : {}),
            })
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                success,
                logged: wasLogged(),
                command: result.command,
            }
        },
        dispose: () => {
            accepting = false
            if (!disposePromise) disposePromise = runtime.dispose()
            return disposePromise
        },
    }
}
