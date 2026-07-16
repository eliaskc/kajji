import { existsSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { Context, Effect, Layer } from "effect"
import { type AppConfig, applyRepoConfig, readConfig } from "../config"
import {
    AppProcess,
    type ProcessError,
    type ProcessOutputStream,
    type ProcessResult,
} from "../process/app-process"
import {
    OperationInterruptedError,
    type OperationSink,
} from "../process/operation-sink"
import { HookOperation, type HookOperationId } from "./types"

export interface HookRunOptions {
    readonly cwd: string
    readonly verify?: boolean
    readonly sink?: OperationSink
}

export type HookRunResult =
    | { readonly success: true }
    | {
          readonly success: false
          readonly command: string
          readonly result: ProcessResult
      }

export interface HooksService {
    readonly hasPreHooks: (
        operationId: HookOperationId,
        cwd: string,
    ) => Effect.Effect<boolean, ProcessError>
    readonly runApplicablePreHooks: (
        operationId: HookOperationId,
        options: HookRunOptions,
    ) => Effect.Effect<HookRunResult, ProcessError>
}

export class Hooks extends Context.Service<Hooks, HooksService>()(
    "kajji/Hooks",
) {}

function expandHome(path: string): string {
    if (path === "~") return homedir()
    if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
    return path
}

function resolvePath(path: string, base: string): string {
    const expanded = expandHome(path)
    return isAbsolute(expanded) ? expanded : resolve(base, expanded)
}

function canonicalPath(path: string, base: string): string {
    const resolved = resolvePath(path, base)
    return existsSync(resolved) ? realpathSync(resolved) : resolved
}

function isPathWithin(path: string, parent: string): boolean {
    return path === parent || path.startsWith(`${parent}/`)
}

function commandText(command: string | { command: string }): string {
    return typeof command === "string" ? command : command.command
}

function isExecutable(path: string): boolean {
    try {
        return (statSync(path).mode & 0o111) !== 0
    } catch {
        return false
    }
}

function configuredHookCommands(
    operationId: HookOperationId,
    cwd: string,
    config: AppConfig,
) {
    const hook = applyRepoConfig(config, cwd).hooks[operationId]
    if (!hook) return []
    if (hook.onlyIn) {
        const repoPath = canonicalPath(cwd, cwd)
        const onlyInPath = canonicalPath(hook.onlyIn, cwd)
        if (!isPathWithin(repoPath, onlyInPath)) return []
    }
    return hook.pre
}

interface HookOperationPolicy {
    readonly gitPreCommit: boolean
}

const hookOperationPolicies = {
    [HookOperation.JjNew]: { gitPreCommit: true },
} satisfies Record<HookOperationId, HookOperationPolicy>

function notify(fn: () => void) {
    try {
        fn()
    } catch {
        // Hook observation must never affect execution.
    }
}

export function makeHooksLayer(
    getConfig: () => AppConfig = readConfig,
): Layer.Layer<Hooks, never, AppProcess> {
    return Layer.effect(
        Hooks,
        Effect.gen(function* () {
            const appProcess = yield* AppProcess

            const resolveGitHooksPath = Effect.fn("Hooks.resolveGitHooksPath")(
                function* (cwd: string) {
                    const configuredPath = applyRepoConfig(
                        getConfig(),
                        cwd,
                    ).gitHooksPath
                    if (configuredPath === false) return undefined
                    if (configuredPath) return resolvePath(configuredPath, cwd)

                    const result = yield* appProcess.run({
                        executable: "git",
                        args: ["config", "--path", "--get", "core.hooksPath"],
                        cwd,
                    })
                    if (result.exitCode !== 0) return undefined
                    const path = result.stdout.trim()
                    return path ? resolvePath(path, cwd) : undefined
                },
            )

            const gitPreCommitHook = Effect.fn("Hooks.gitPreCommitHook")(
                function* (cwd: string) {
                    const hooksPath = yield* resolveGitHooksPath(cwd)
                    if (!hooksPath) return undefined
                    const hookPath = join(hooksPath, "pre-commit")
                    return existsSync(hookPath) ? hookPath : undefined
                },
            )

            interface ResolvedHook {
                readonly command: string
                readonly executable: string
                readonly args: readonly string[]
                readonly env?: Readonly<Record<string, string>>
            }

            const resolvePreHooks = Effect.fn("Hooks.resolvePreHooks")(
                function* (operationId: HookOperationId, cwd: string) {
                    const policy = hookOperationPolicies[operationId]
                    const hooks: ResolvedHook[] = configuredHookCommands(
                        operationId,
                        cwd,
                        getConfig(),
                    ).map((hookCommand) => {
                        const command = commandText(hookCommand)
                        return {
                            command,
                            executable: "sh",
                            args: ["-lc", command],
                            env:
                                typeof hookCommand === "string"
                                    ? undefined
                                    : hookCommand.env,
                        }
                    })
                    const skipped: string[] = []

                    if (policy.gitPreCommit) {
                        const hookPath = yield* gitPreCommitHook(cwd)
                        if (hookPath) {
                            if (isExecutable(hookPath)) {
                                hooks.push({
                                    command: hookPath,
                                    executable: hookPath,
                                    args: [],
                                })
                            } else {
                                skipped.push(
                                    `${hookPath} skipped because it is not executable`,
                                )
                            }
                        }
                    }

                    return { hooks, skipped }
                },
            )

            const runHook = Effect.fn("Hooks.runHook")(function* (
                hook: ResolvedHook,
                options: HookRunOptions,
            ) {
                const { command, ...process } = hook
                notify(() => options.sink?.start(command, "hook"))
                const result = yield* appProcess
                    .run({
                        ...process,
                        cwd: options.cwd,
                        onOutput: (
                            stream: ProcessOutputStream,
                            chunk: string,
                        ) => notify(() => options.sink?.output(stream, chunk)),
                    })
                    .pipe(
                        Effect.tapError((error) =>
                            Effect.sync(() =>
                                notify(() => options.sink?.fail(error)),
                            ),
                        ),
                        Effect.onInterrupt(() =>
                            Effect.sync(() =>
                                notify(() =>
                                    options.sink?.fail(
                                        new OperationInterruptedError({
                                            command,
                                        }),
                                    ),
                                ),
                            ),
                        ),
                    )
                notify(() => options.sink?.finish(result))
                return result
            })

            return Hooks.of({
                hasPreHooks: Effect.fn("Hooks.hasPreHooks")(function* (
                    operationId: HookOperationId,
                    cwd: string,
                ) {
                    const resolved = yield* resolvePreHooks(operationId, cwd)
                    return resolved.hooks.length > 0
                }),
                runApplicablePreHooks: Effect.fn("Hooks.runApplicablePreHooks")(
                    function* (
                        operationId: HookOperationId,
                        options: HookRunOptions,
                    ) {
                        if (options.verify === false) {
                            notify(() =>
                                options.sink?.skip(
                                    `pre-hooks for ${operationId} skipped (--no-verify)`,
                                ),
                            )
                            return { success: true } as const
                        }

                        const resolved = yield* resolvePreHooks(
                            operationId,
                            options.cwd,
                        )
                        for (const message of resolved.skipped) {
                            notify(() => options.sink?.skip(message))
                        }
                        for (const hook of resolved.hooks) {
                            const result = yield* runHook(hook, options)
                            if (result.exitCode !== 0) {
                                return {
                                    success: false,
                                    command: hook.command,
                                    result,
                                } as const
                            }
                        }

                        return { success: true } as const
                    },
                ),
            })
        }),
    )
}

export const HooksLive = makeHooksLayer()
