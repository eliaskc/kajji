import { Context, Effect, Layer } from "effect"
import { AppProcess, type ProcessError } from "../process/app-process"

export interface GitReadOptions {
    readonly cwd: string
    readonly timeoutMs?: number
}

export interface GitService {
    readonly originRemoteUrl: (
        options: GitReadOptions,
    ) => Effect.Effect<string | undefined, ProcessError>
}

export class Git extends Context.Service<Git, GitService>()("kajji/Git") {}

export const GitLive = Layer.effect(
    Git,
    Effect.gen(function* () {
        const appProcess = yield* AppProcess

        return Git.of({
            originRemoteUrl: Effect.fn("Git.originRemoteUrl")(function* (
                options: GitReadOptions,
            ) {
                const result = yield* appProcess.run({
                    executable: "git",
                    args: ["remote", "get-url", "origin"],
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                })
                if (result.exitCode !== 0) return undefined
                const url = result.stdout.trim()
                return url.length > 0 ? url : undefined
            }),
        })
    }),
)
