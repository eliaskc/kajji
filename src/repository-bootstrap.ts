import { Context, Effect, Layer } from "effect"
import { Git } from "./commander/git"
import { Jj, type JjCommandError } from "./commander/jj"
import type { ProcessError } from "./process/app-process"

export interface RepositoryStatus {
    readonly isJjRepo: boolean
    readonly hasGitRepo: boolean
    readonly startupError: string | null
    readonly repoPath: string
}

export interface RepositoryInitResult {
    readonly success: boolean
    readonly error?: string
}

export interface RepositoryBootstrapService {
    readonly inspect: (path: string) => Effect.Effect<RepositoryStatus>
    readonly initialize: (
        path: string,
        options?: { readonly colocate?: boolean },
    ) => Effect.Effect<RepositoryInitResult>
}

export class RepositoryBootstrap extends Context.Service<
    RepositoryBootstrap,
    RepositoryBootstrapService
>()("kajji/RepositoryBootstrap") {}

function processFailureMessage(error: JjCommandError | ProcessError): string {
    if (error._tag === "JjCommandError") {
        return error.result.stderr.trim() || "jj git init failed"
    }
    if ("cause" in error) {
        return error.cause instanceof Error
            ? error.cause.message
            : String(error.cause)
    }
    return error.message
}

export const RepositoryBootstrapLive: Layer.Layer<
    RepositoryBootstrap,
    never,
    Jj | Git
> = Layer.effect(
    RepositoryBootstrap,
    Effect.gen(function* () {
        const jj = yield* Jj
        const git = yield* Git

        return RepositoryBootstrap.of({
            inspect: Effect.fn("RepositoryBootstrap.inspect")(function* (
                path: string,
            ) {
                const jjRoot = yield* jj
                    .repositoryRoot({ cwd: path, timeoutMs: 2000 })
                    .pipe(
                        Effect.match({
                            onFailure: () => undefined,
                            onSuccess: (root) => root,
                        }),
                    )
                const repoPath = jjRoot ?? path
                const hasGitRepo = yield* git
                    .isRepository({ cwd: repoPath, timeoutMs: 2000 })
                    .pipe(
                        Effect.match({
                            onFailure: () => false,
                            onSuccess: (isRepository) => isRepository,
                        }),
                    )
                const staleError = jjRoot
                    ? yield* jj
                          .checkWorkingCopy({
                              cwd: repoPath,
                              timeoutMs: 5000,
                          })
                          .pipe(
                              Effect.match({
                                  onFailure: (error) =>
                                      error._tag === "JjStaleWorkingCopyError"
                                          ? error.output
                                          : undefined,
                                  onSuccess: () => undefined,
                              }),
                          )
                    : undefined

                return {
                    isJjRepo: jjRoot !== undefined,
                    hasGitRepo,
                    startupError: staleError ?? null,
                    repoPath,
                }
            }),
            initialize: Effect.fn("RepositoryBootstrap.initialize")(
                (path: string, options = {}) =>
                    jj.gitInit({ cwd: path, colocate: options.colocate }).pipe(
                        Effect.match({
                            onFailure: (error) => ({
                                success: false,
                                error: processFailureMessage(error),
                            }),
                            onSuccess: () => ({ success: true }),
                        }),
                    ),
            ),
        })
    }),
)
