import { Context, Effect, Layer, Schema } from "effect"

export interface InteractiveProcessCommand {
    readonly executable: string
    readonly args: readonly string[]
    readonly cwd: string
    readonly env?: Readonly<Record<string, string>>
}

export interface InteractiveProcessResult {
    readonly exitCode: number
    readonly durationMs: number
}

const InteractiveProcessCommandDiagnostic = Schema.Struct({
    executable: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.String,
})

export class InteractiveProcessSpawnError extends Schema.TaggedErrorClass<InteractiveProcessSpawnError>()(
    "InteractiveProcessSpawnError",
    {
        command: InteractiveProcessCommandDiagnostic,
        cause: Schema.Defect(),
    },
) {}

export interface InteractiveProcessService {
    readonly run: (
        command: InteractiveProcessCommand,
    ) => Effect.Effect<InteractiveProcessResult, InteractiveProcessSpawnError>
}

export class InteractiveProcess extends Context.Service<
    InteractiveProcess,
    InteractiveProcessService
>()("kajji/InteractiveProcess") {}

interface InteractiveChildHandle {
    readonly exitCode: number | null
    readonly exited: Promise<number>
    kill(signal?: number | NodeJS.Signals): void
}

function terminateChild(child: InteractiveChildHandle): Effect.Effect<void> {
    return Effect.promise(async () => {
        if (child.exitCode !== null) return
        try {
            child.kill("SIGTERM")
        } catch {
            return
        }
        const exited = await Promise.race([
            child.exited.then(() => true),
            Bun.sleep(500).then(() => false),
        ])
        if (!exited) {
            try {
                child.kill("SIGKILL")
            } catch {
                // The child may have exited between the checks above.
            }
            await child.exited.catch(() => {})
        }
    })
}

const runLive = Effect.fn("InteractiveProcess.run")(function* (
    command: InteractiveProcessCommand,
) {
    const startedAt = performance.now()
    const child = yield* Effect.acquireRelease(
        Effect.try({
            try: () =>
                Bun.spawn([command.executable, ...command.args], {
                    cwd: command.cwd,
                    env: { ...process.env, ...command.env },
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                }) as unknown as InteractiveChildHandle,
            catch: (cause) =>
                new InteractiveProcessSpawnError({ command, cause }),
        }),
        terminateChild,
    )
    const exitCode = yield* Effect.promise(() => child.exited)
    return {
        exitCode,
        durationMs: performance.now() - startedAt,
    }
})

export const InteractiveProcessLive: Layer.Layer<InteractiveProcess> =
    Layer.succeed(
        InteractiveProcess,
        InteractiveProcess.of({
            run: (command) => Effect.scoped(runLive(command)),
        }),
    )

export function makeInteractiveProcessFake(
    run: InteractiveProcessService["run"],
): Layer.Layer<InteractiveProcess> {
    return Layer.succeed(InteractiveProcess, InteractiveProcess.of({ run }))
}
