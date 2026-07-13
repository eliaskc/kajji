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

export interface JjGitFetchOptions {
    readonly cwd: string
    readonly allRemotes?: boolean
    readonly tracked?: boolean
    readonly branches?: readonly string[]
    readonly remotes?: readonly string[]
    readonly timeoutMs?: number
    readonly sink?: OperationSink
}

export interface JjGitFetchResult extends ProcessResult {
    readonly command: string
}

export class JjCommandError extends Data.TaggedError("JjCommandError")<{
    readonly command: string
    readonly result: ProcessResult
}> {}

export interface JjService {
    readonly gitFetch: (
        options: JjGitFetchOptions,
    ) => Effect.Effect<JjGitFetchResult, JjCommandError | ProcessError>
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
    options: Omit<JjGitFetchOptions, "cwd" | "sink" | "timeoutMs">,
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

export const JjLive = Layer.effect(
    Jj,
    Effect.gen(function* () {
        const appProcess = yield* AppProcess

        const gitFetch = Effect.fn("Jj.gitFetch")(function* (
            options: JjGitFetchOptions,
        ) {
            const args = makeGitFetchArgs(options)
            const command = `jj ${args.join(" ")}`
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

        return Jj.of({ gitFetch })
    }),
)
