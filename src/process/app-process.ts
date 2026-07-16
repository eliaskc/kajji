import { Context, Data, Effect, Layer } from "effect"

export type ProcessOutputStream = "stdout" | "stderr"

export interface ProcessCommand {
    readonly executable: string
    readonly args: readonly string[]
    readonly cwd: string
    readonly env?: Readonly<Record<string, string>>
    readonly timeoutMs?: number
    readonly stdin?: string
    readonly stdoutFile?: string
    readonly onOutput?: (
        stream: ProcessOutputStream,
        chunk: string,
    ) => void | Promise<void>
}

export interface ProcessResult {
    readonly stdout: string
    readonly stderr: string
    readonly exitCode: number
    readonly durationMs: number
}

export class ProcessSpawnError extends Data.TaggedError("ProcessSpawnError")<{
    readonly command: ProcessCommand
    readonly cause: unknown
}> {}

export class ProcessReadError extends Data.TaggedError("ProcessReadError")<{
    readonly command: ProcessCommand
    readonly stream: ProcessOutputStream
    readonly cause: unknown
}> {}

export class ProcessWriteError extends Data.TaggedError("ProcessWriteError")<{
    readonly command: ProcessCommand
    readonly cause: unknown
}> {}

export class ProcessTimeoutError extends Data.TaggedError(
    "ProcessTimeoutError",
)<{
    readonly command: ProcessCommand
    readonly timeoutMs: number
}> {}

export type ProcessError =
    | ProcessSpawnError
    | ProcessReadError
    | ProcessWriteError
    | ProcessTimeoutError

export interface AppProcessService {
    readonly run: (
        command: ProcessCommand,
    ) => Effect.Effect<ProcessResult, ProcessError>
}

export class AppProcess extends Context.Service<
    AppProcess,
    AppProcessService
>()("kajji/AppProcess") {}

interface ChildHandle {
    readonly pid: number
    readonly stdin?: {
        write(input: string): unknown
        end(): unknown
    }
    readonly stdout?: ReadableStream<Uint8Array>
    readonly stderr: ReadableStream<Uint8Array>
    readonly exited: Promise<number>
    readonly exitCode: number | null
    kill(signal?: number | NodeJS.Signals): void
}

async function notifyOutput(
    command: ProcessCommand,
    stream: ProcessOutputStream,
    chunk: string,
) {
    try {
        await command.onOutput?.(stream, chunk)
    } catch {
        // Output consumption is deliberately infallible at the process edge.
    }
}

function readOutput(
    command: ProcessCommand,
    stream: ProcessOutputStream,
    input: ReadableStream<Uint8Array>,
) {
    return Effect.tryPromise({
        try: async () => {
            const reader = input.getReader()
            const decoder = new TextDecoder()
            let output = ""
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    const chunk = decoder.decode(value, { stream: true })
                    output += chunk
                    await notifyOutput(command, stream, chunk)
                }
                const tail = decoder.decode()
                if (tail) {
                    output += tail
                    await notifyOutput(command, stream, tail)
                }
                return output
            } finally {
                reader.releaseLock()
            }
        },
        catch: (cause) => new ProcessReadError({ command, stream, cause }),
    })
}

async function terminateChild(child: ChildHandle) {
    if (child.exitCode !== null) return

    const signalGroup = (signal: NodeJS.Signals) => {
        if (process.platform !== "win32") {
            try {
                process.kill(-child.pid, signal)
                return
            } catch {
                // Fall back to the Bun handle if the process group is already gone.
            }
        }
        try {
            child.kill(signal)
        } catch {
            // The child may have exited between the checks above.
        }
    }

    signalGroup("SIGTERM")
    const exited = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(500).then(() => false),
    ])
    if (!exited) {
        signalGroup("SIGKILL")
        await child.exited.catch(() => {})
    }
}

const runLive = Effect.fn("AppProcess.run")(function* (
    command: ProcessCommand,
) {
    const startedAt = performance.now()
    const child = yield* Effect.acquireRelease(
        Effect.try({
            try: () =>
                Bun.spawn([command.executable, ...command.args], {
                    cwd: command.cwd,
                    env: { ...process.env, ...command.env },
                    stdin: command.stdin === undefined ? "ignore" : "pipe",
                    stdout: command.stdoutFile
                        ? Bun.file(command.stdoutFile)
                        : "pipe",
                    stderr: "pipe",
                    detached: process.platform !== "win32",
                }) as unknown as ChildHandle,
            catch: (cause) => new ProcessSpawnError({ command, cause }),
        }),
        (child) => Effect.promise(() => terminateChild(child)),
    )

    if (command.stdin !== undefined) {
        yield* Effect.try({
            try: () => {
                child.stdin?.write(command.stdin as string)
                child.stdin?.end()
            },
            catch: (cause) => new ProcessWriteError({ command, cause }),
        })
    }

    const collect = Effect.all(
        [
            child.stdout
                ? readOutput(command, "stdout", child.stdout)
                : Effect.succeed(""),
            readOutput(command, "stderr", child.stderr),
            Effect.promise(() => child.exited),
        ] as const,
        { concurrency: "unbounded" },
    ).pipe(
        Effect.map(([stdout, stderr, exitCode]) => ({
            stdout,
            stderr,
            exitCode,
            durationMs: performance.now() - startedAt,
        })),
    )

    if (command.timeoutMs === undefined) return yield* collect
    return yield* Effect.timeoutOrElse(collect, {
        duration: command.timeoutMs,
        orElse: () =>
            Effect.fail(
                new ProcessTimeoutError({
                    command,
                    timeoutMs: command.timeoutMs as number,
                }),
            ),
    })
})

export const AppProcessLive = Layer.succeed(AppProcess)(
    AppProcess.of({
        run: (command) => Effect.scoped(runLive(command)),
    }),
)

export function makeAppProcessFake(
    run: AppProcessService["run"],
): Layer.Layer<AppProcess> {
    return Layer.succeed(AppProcess)(AppProcess.of({ run }))
}
