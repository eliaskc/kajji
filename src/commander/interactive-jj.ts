import { Context, Effect, Layer } from "effect"
import {
    InteractiveProcess,
    type InteractiveProcessSpawnError,
} from "../process/interactive-process"

export interface InteractiveJjOptions {
    readonly cwd: string
    readonly ignoreImmutable?: boolean
}

export interface InteractiveJjResolveOptions {
    readonly cwd: string
    readonly revision?: string
    readonly paths?: readonly string[]
    readonly tool?: string
}

export interface InteractiveJjSquashOptions extends InteractiveJjOptions {
    readonly into?: string
    readonly useDestinationMessage?: boolean
    readonly keepEmptied?: boolean
}

export interface InteractiveJjResult {
    readonly command: string
    readonly exitCode: number
}

export interface InteractiveJjService {
    readonly split: (
        revision: string,
        options: InteractiveJjOptions,
    ) => Effect.Effect<InteractiveJjResult, InteractiveProcessSpawnError>
    readonly resolve: (
        options: InteractiveJjResolveOptions,
    ) => Effect.Effect<InteractiveJjResult, InteractiveProcessSpawnError>
    readonly squash: (
        revision: string,
        options: InteractiveJjSquashOptions,
    ) => Effect.Effect<InteractiveJjResult, InteractiveProcessSpawnError>
}

export class InteractiveJj extends Context.Service<
    InteractiveJj,
    InteractiveJjService
>()("kajji/InteractiveJj") {}

export const InteractiveJjLive: Layer.Layer<
    InteractiveJj,
    never,
    InteractiveProcess
> = Layer.effect(
    InteractiveJj,
    Effect.gen(function* () {
        const process = yield* InteractiveProcess

        const run = Effect.fn("InteractiveJj.run")(function* (
            args: readonly string[],
            cwd: string,
        ) {
            const result = yield* process.run({
                executable: "jj",
                args,
                cwd,
            })
            return {
                command: `jj ${args.join(" ")}`,
                exitCode: result.exitCode,
            }
        })

        return InteractiveJj.of({
            split: Effect.fn("InteractiveJj.split")((revision, options) =>
                run(
                    [
                        "split",
                        "-r",
                        revision,
                        ...(options.ignoreImmutable
                            ? ["--ignore-immutable"]
                            : []),
                    ],
                    options.cwd,
                ),
            ),
            resolve: Effect.fn("InteractiveJj.resolve")((options) =>
                run(
                    [
                        "resolve",
                        ...(options.revision ? ["-r", options.revision] : []),
                        ...(options.tool ? ["--tool", options.tool] : []),
                        ...(options.paths ?? []),
                    ],
                    options.cwd,
                ),
            ),
            squash: Effect.fn("InteractiveJj.squash")((revision, options) =>
                run(
                    [
                        "squash",
                        "-i",
                        ...(options.into
                            ? ["--from", revision, "--into", options.into]
                            : ["-r", revision]),
                        ...(options.useDestinationMessage ? ["-u"] : []),
                        ...(options.keepEmptied ? ["-k"] : []),
                        ...(options.ignoreImmutable
                            ? ["--ignore-immutable"]
                            : []),
                    ],
                    options.cwd,
                ),
            ),
        })
    }),
)
