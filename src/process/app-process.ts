import { Context, Effect, Layer, Queue, Schema, Stream } from "effect"

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

export const ProcessResult = Schema.Struct({
    stdout: Schema.String,
    stderr: Schema.String,
    exitCode: Schema.Number,
    durationMs: Schema.Number,
})

export interface ProcessResult
    extends Schema.Schema.Type<typeof ProcessResult> {}

export type ProcessEvent =
    | {
          readonly _tag: "Output"
          readonly stream: ProcessOutputStream
          readonly chunk: string
      }
    | {
          readonly _tag: "Complete"
          readonly result: ProcessResult
      }

const ProcessCommandDiagnostic = Schema.Struct({
    executable: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.String,
})

export class ProcessSpawnError extends Schema.TaggedErrorClass<ProcessSpawnError>()(
    "ProcessSpawnError",
    {
        command: ProcessCommandDiagnostic,
        cause: Schema.Defect(),
    },
) {}

export class ProcessReadError extends Schema.TaggedErrorClass<ProcessReadError>()(
    "ProcessReadError",
    {
        command: ProcessCommandDiagnostic,
        stream: Schema.Literals(["stdout", "stderr"]),
        cause: Schema.Defect(),
    },
) {}

export class ProcessWriteError extends Schema.TaggedErrorClass<ProcessWriteError>()(
    "ProcessWriteError",
    {
        command: ProcessCommandDiagnostic,
        cause: Schema.Defect(),
    },
) {}

export class ProcessTimeoutError extends Schema.TaggedErrorClass<ProcessTimeoutError>()(
    "ProcessTimeoutError",
    {
        command: ProcessCommandDiagnostic,
        timeoutMs: Schema.Number,
    },
) {}

export type ProcessError =
    | ProcessSpawnError
    | ProcessReadError
    | ProcessWriteError
    | ProcessTimeoutError

export interface AppProcessService {
    readonly run: (
        command: ProcessCommand,
    ) => Effect.Effect<ProcessResult, ProcessError>
    readonly stream: (
        command: Omit<ProcessCommand, "onOutput">,
    ) => Stream.Stream<ProcessEvent, ProcessError>
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

function readOutput<E>(
    command: ProcessCommand,
    stream: ProcessOutputStream,
    input: ReadableStream<Uint8Array>,
    emit: (chunk: string) => Effect.Effect<unknown, E>,
) {
    return Effect.scoped(
        Effect.gen(function* () {
            const reader = yield* Effect.acquireRelease(
                Effect.sync(() => input.getReader()),
                (reader) => Effect.sync(() => reader.releaseLock()),
            )
            const decoder = new TextDecoder()
            let output = ""
            while (true) {
                const { done, value } = yield* Effect.tryPromise({
                    try: () => reader.read(),
                    catch: (cause) =>
                        new ProcessReadError({ command, stream, cause }),
                })
                if (done) break
                const chunk = decoder.decode(value, { stream: true })
                output += chunk
                yield* emit(chunk)
            }
            const tail = decoder.decode()
            if (tail) {
                output += tail
                yield* emit(tail)
            }
            return output
        }),
    )
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
    let result: ProcessResult | undefined
    yield* streamLive(command).pipe(
        Stream.runForEach((event) => {
            if (event._tag === "Complete") {
                return Effect.sync(() => {
                    result = event.result
                })
            }
            return Effect.promise(() =>
                notifyOutput(command, event.stream, event.chunk),
            )
        }),
    )
    if (result === undefined) {
        return yield* Effect.die(
            new Error("Process stream completed without an exit result"),
        )
    }
    return result
})

function streamLive(
    command: Omit<ProcessCommand, "onOutput">,
): Stream.Stream<ProcessEvent, ProcessError> {
    return Stream.callback<ProcessEvent, ProcessError>(
        (queue) =>
            Effect.gen(function* () {
                const producer = Effect.gen(function* () {
                    const startedAt = performance.now()
                    const child = yield* Effect.acquireRelease(
                        Effect.try({
                            try: () =>
                                Bun.spawn(
                                    [command.executable, ...command.args],
                                    {
                                        cwd: command.cwd,
                                        env: {
                                            ...process.env,
                                            ...command.env,
                                        },
                                        stdin:
                                            command.stdin === undefined
                                                ? "ignore"
                                                : "pipe",
                                        stdout: command.stdoutFile
                                            ? Bun.file(command.stdoutFile)
                                            : "pipe",
                                        stderr: "pipe",
                                        detached: process.platform !== "win32",
                                    },
                                ) as unknown as ChildHandle,
                            catch: (cause) =>
                                new ProcessSpawnError({ command, cause }),
                        }),
                        (child) => Effect.promise(() => terminateChild(child)),
                    )

                    if (command.stdin !== undefined) {
                        yield* Effect.try({
                            try: () => {
                                child.stdin?.write(command.stdin as string)
                                child.stdin?.end()
                            },
                            catch: (cause) =>
                                new ProcessWriteError({ command, cause }),
                        })
                    }

                    const collect = Effect.all(
                        [
                            child.stdout
                                ? readOutput(
                                      command,
                                      "stdout",
                                      child.stdout,
                                      (chunk) =>
                                          Queue.offer(queue, {
                                              _tag: "Output",
                                              stream: "stdout",
                                              chunk,
                                          }),
                                  )
                                : Effect.succeed(""),
                            readOutput(
                                command,
                                "stderr",
                                child.stderr,
                                (chunk) =>
                                    Queue.offer(queue, {
                                        _tag: "Output",
                                        stream: "stderr",
                                        chunk,
                                    }),
                            ),
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
                    const timeoutMs = command.timeoutMs
                    return yield* timeoutMs === undefined
                        ? collect
                        : Effect.timeoutOrElse(collect, {
                              duration: timeoutMs,
                              orElse: () =>
                                  Effect.fail(
                                      new ProcessTimeoutError({
                                          command,
                                          timeoutMs,
                                      }),
                                  ),
                          })
                })

                yield* producer.pipe(
                    Effect.flatMap((result) =>
                        Queue.offer(queue, {
                            _tag: "Complete",
                            result,
                        }),
                    ),
                    Effect.matchCauseEffect({
                        onFailure: (cause) => Queue.failCause(queue, cause),
                        onSuccess: () => Queue.end(queue),
                    }),
                    Effect.forkScoped,
                )
            }),
        { bufferSize: 1, strategy: "suspend" },
    )
}

export const AppProcessLive = Layer.succeed(AppProcess)(
    AppProcess.of({
        run: (command) => Effect.scoped(runLive(command)),
        stream: streamLive,
    }),
)

export function makeAppProcessFake(
    run: AppProcessService["run"],
    stream: AppProcessService["stream"] = (command) =>
        Stream.fromEffect(run(command)).pipe(
            Stream.map((result) => ({
                _tag: "Complete" as const,
                result,
            })),
        ),
): Layer.Layer<AppProcess> {
    return Layer.succeed(AppProcess)(AppProcess.of({ run, stream }))
}
