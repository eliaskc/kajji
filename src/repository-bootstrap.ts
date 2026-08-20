import { randomUUID } from "node:crypto"
import { lstat, rename, rm } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Git } from "./commander/git"
import { Jj, type JjCommandError, type OperationSink } from "./commander/jj"
import type { ProcessError } from "./process/app-process"

export interface BrokenRepositoryMetadata {
    readonly jj: boolean
    readonly git: boolean
}

export interface RepositoryStatus {
    readonly isJjRepo: boolean
    readonly hasGitRepo: boolean
    readonly brokenMetadata: BrokenRepositoryMetadata | null
    readonly startupError: string | null
    readonly repoPath: string
}

export interface RepositoryInitResult {
    readonly success: boolean
    readonly error?: string
}

export type RepositoryRecoveryMode = "backup" | "remove"

export interface RepositoryRecoveryResult extends RepositoryInitResult {
    readonly backups?: readonly string[]
    readonly warning?: string
}

export interface RepositoryBootstrapService {
    readonly inspect: (path: string) => Effect.Effect<RepositoryStatus>
    readonly initialize: (
        path: string,
        options?: {
            readonly colocate?: boolean
            readonly sink?: OperationSink
        },
    ) => Effect.Effect<RepositoryInitResult>
    readonly recover: (
        path: string,
        options?: {
            readonly mode?: RepositoryRecoveryMode
            readonly colocate?: boolean
            readonly sink?: OperationSink
        },
    ) => Effect.Effect<RepositoryRecoveryResult>
}

export class RepositoryBootstrap extends Context.Service<
    RepositoryBootstrap,
    RepositoryBootstrapService
>()("kajji/RepositoryBootstrap") {}

export interface MetadataBackup {
    readonly original: string
    readonly backup: string
}

export interface MetadataFilesystem {
    readonly exists: (path: string) => Promise<boolean>
    readonly rename: (from: string, to: string) => Promise<void>
    readonly remove: (path: string) => Promise<void>
}

const metadataFilesystem: MetadataFilesystem = {
    exists: pathExists,
    rename,
    remove: (path) => rm(path, { recursive: true, force: true }),
}

function processFailureMessage(error: JjCommandError | ProcessError): string {
    if (error._tag === "JjCommandError") {
        return error.result.stderr.trim() || "jj git init failed"
    }
    if ("cause" in error) {
        return error.cause instanceof Error ? error.cause.message : String(error.cause)
    }
    return error.message
}

function unknownErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function reportRecoveryStart(sink: OperationSink | undefined, label: string): number {
    try {
        sink?.start(label, "shell")
    } catch {
        // Progress reporting must not stop repository recovery.
    }
    return performance.now()
}

function reportRecoveryFinish(
    sink: OperationSink | undefined,
    startedAt: number,
    output: { readonly stdout?: string; readonly stderr?: string; readonly success: boolean },
) {
    const stdout = output.stdout ?? ""
    const stderr = output.stderr ?? ""
    try {
        if (stdout) sink?.output("stdout", stdout)
        if (stderr) sink?.output("stderr", stderr)
        sink?.finish({
            stdout,
            stderr,
            exitCode: output.success ? 0 : 1,
            durationMs: performance.now() - startedAt,
        })
    } catch {
        // Progress reporting must not stop repository recovery.
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path)
        return true
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            return false
        }
        return true
    }
}

async function isDirectory(path: string): Promise<boolean> {
    try {
        return (await lstat(path)).isDirectory()
    } catch {
        return false
    }
}

async function findMetadataRoot(path: string): Promise<string | undefined> {
    let candidate = resolve(path)
    while (true) {
        if (await pathExists(join(candidate, ".jj"))) return candidate
        const parent = dirname(candidate)
        if (parent === candidate) return undefined
        candidate = parent
    }
}

async function hasProvablyBrokenJjMarker(path: string): Promise<boolean> {
    const marker = join(path, ".jj")
    return (await isDirectory(marker)) && !(await pathExists(join(marker, "repo", "store", "type")))
}

async function hasProvablyBrokenGitMarker(path: string): Promise<boolean> {
    const marker = join(path, ".git")
    return (await isDirectory(marker)) && !(await pathExists(join(marker, "HEAD")))
}

function backupPath(path: string, timestamp: string): string {
    return `${path}.kajji-backup-${timestamp}-${randomUUID().slice(0, 8)}`
}

export async function restoreMetadataBackups(
    backups: readonly MetadataBackup[],
    filesystem: MetadataFilesystem = metadataFilesystem,
): Promise<string | null> {
    const displaced: MetadataBackup[] = []
    const restored: MetadataBackup[] = []
    try {
        for (const entry of backups.toReversed()) {
            if (await filesystem.exists(entry.original)) {
                const temporary = `${entry.original}.kajji-new-${randomUUID().slice(0, 8)}`
                await filesystem.rename(entry.original, temporary)
                displaced.push({ original: entry.original, backup: temporary })
            }
            await filesystem.rename(entry.backup, entry.original)
            restored.push(entry)
        }
    } catch (error) {
        for (const entry of restored.toReversed()) {
            await filesystem.rename(entry.original, entry.backup).catch(() => undefined)
        }
        for (const entry of displaced.toReversed()) {
            await filesystem.rename(entry.backup, entry.original).catch(() => undefined)
        }
        return unknownErrorMessage(error)
    }
    for (const entry of displaced) {
        await filesystem.remove(entry.backup).catch(() => undefined)
    }
    return null
}

export async function removeMetadataBackups(
    backups: readonly MetadataBackup[],
    filesystem: MetadataFilesystem = metadataFilesystem,
): Promise<string | null> {
    const errors: string[] = []
    for (const entry of backups) {
        try {
            await filesystem.remove(entry.backup)
        } catch (error) {
            errors.push(`${entry.backup}: ${unknownErrorMessage(error)}`)
        }
    }
    return errors.length > 0 ? errors.join("\n") : null
}

export function permanentRemovalResult(
    backupPaths: readonly string[],
    removalError: string | null,
): RepositoryRecoveryResult {
    return {
        success: true,
        ...(removalError
            ? {
                  backups: backupPaths,
                  warning: `The new repository was created, but some old metadata could not be removed:\n${removalError}`,
              }
            : {}),
    }
}

async function backupMetadata(
    repositoryPath: string,
    metadata: BrokenRepositoryMetadata,
): Promise<
    | { readonly success: true; readonly backups: readonly MetadataBackup[] }
    | { readonly success: false; readonly error: string }
> {
    const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
    const markers = [
        ...(metadata.jj ? [join(repositoryPath, ".jj")] : []),
        ...(metadata.git ? [join(repositoryPath, ".git")] : []),
    ]
    const backups: MetadataBackup[] = []

    try {
        for (const original of markers) {
            const backup = backupPath(original, timestamp)
            await rename(original, backup)
            backups.push({ original, backup })
        }
        return { success: true, backups }
    } catch (error) {
        const restoreError = await restoreMetadataBackups(backups)
        return {
            success: false,
            error: [
                `Failed to back up repository metadata: ${unknownErrorMessage(error)}`,
                restoreError ? `Failed to restore metadata:\n${restoreError}` : null,
            ]
                .filter((message): message is string => message !== null)
                .join("\n"),
        }
    }
}

export const RepositoryBootstrapLive: Layer.Layer<RepositoryBootstrap, never, Jj | Git> =
    Layer.effect(
        RepositoryBootstrap,
        Effect.gen(function* () {
            const jj = yield* Jj
            const git = yield* Git

            const inspect = Effect.fn("RepositoryBootstrap.inspect")(function* (path: string) {
                const inspectedPath = resolve(path)
                const jjRoot = yield* jj
                    .repositoryRoot({ cwd: inspectedPath, timeoutMs: 2000 })
                    .pipe(
                        Effect.match({
                            onFailure: () => undefined,
                            onSuccess: (root) => root,
                        }),
                    )
                const metadataRoot = jjRoot
                    ? undefined
                    : yield* Effect.promise(() => findMetadataRoot(inspectedPath))
                const repoPath = jjRoot ?? metadataRoot ?? inspectedPath
                const gitStatus = yield* git.isRepository({ cwd: repoPath, timeoutMs: 2000 }).pipe(
                    Effect.match({
                        onFailure: () => ({ checked: false, isRepository: false }),
                        onSuccess: (isRepository) => ({ checked: true, isRepository }),
                    }),
                )
                const jjStatus = jjRoot
                    ? yield* jj
                          .checkWorkingCopy({
                              cwd: repoPath,
                              timeoutMs: 5000,
                          })
                          .pipe(
                              Effect.match({
                                  onFailure: (error) => ({
                                      isJjRepo: true,
                                      startupError:
                                          error._tag === "JjStaleWorkingCopyError"
                                              ? error.output
                                              : error.message,
                                  }),
                                  onSuccess: () => ({ isJjRepo: true, startupError: null }),
                              }),
                          )
                    : { isJjRepo: false, startupError: null }
                const brokenMetadata = yield* Effect.promise(async () => ({
                    jj: await hasProvablyBrokenJjMarker(repoPath),
                    git:
                        gitStatus.checked &&
                        !gitStatus.isRepository &&
                        (await hasProvablyBrokenGitMarker(repoPath)),
                }))

                return {
                    isJjRepo: brokenMetadata.jj ? false : jjStatus.isJjRepo,
                    hasGitRepo: gitStatus.isRepository,
                    brokenMetadata: brokenMetadata.jj || brokenMetadata.git ? brokenMetadata : null,
                    startupError: brokenMetadata.jj ? null : jjStatus.startupError,
                    repoPath,
                }
            })

            const initialize = Effect.fn("RepositoryBootstrap.initialize")(
                (
                    path: string,
                    options: {
                        readonly colocate?: boolean
                        readonly sink?: OperationSink
                    } = {},
                ) =>
                    jj
                        .gitInit({
                            cwd: path,
                            colocate: options.colocate,
                            sink: options.sink,
                        })
                        .pipe(
                            Effect.match({
                                onFailure: (error) => ({
                                    success: false,
                                    error: processFailureMessage(error),
                                }),
                                onSuccess: () => ({ success: true }),
                            }),
                        ),
            )

            const recover = Effect.fn("RepositoryBootstrap.recover")(function* (
                path: string,
                options: {
                    readonly mode?: RepositoryRecoveryMode
                    readonly colocate?: boolean
                    readonly sink?: OperationSink
                } = {},
            ) {
                const status = yield* inspect(path)
                const brokenMetadata = status.brokenMetadata
                if (!brokenMetadata) {
                    return {
                        success: false,
                        error: "No broken repository metadata was found",
                    }
                }

                const backupStartedAt = reportRecoveryStart(
                    options.sink,
                    options.mode === "remove"
                        ? "Stage repository metadata"
                        : "Back up repository metadata",
                )
                const backupResult = yield* Effect.promise(() =>
                    backupMetadata(status.repoPath, brokenMetadata),
                )
                if (!backupResult.success) {
                    reportRecoveryFinish(options.sink, backupStartedAt, {
                        stderr: `${backupResult.error}\n`,
                        success: false,
                    })
                    return backupResult
                }

                const backupOutput = backupResult.backups
                    .map((entry) => `${basename(entry.original)} → ${basename(entry.backup)}`)
                    .join("\n")
                reportRecoveryFinish(options.sink, backupStartedAt, {
                    stdout: `${backupOutput}\n`,
                    success: true,
                })

                const initResult = yield* initialize(status.repoPath, options)
                let recoveryError = "error" in initResult ? initResult.error : null
                if (initResult.success) {
                    const validation = yield* inspect(status.repoPath)
                    if (
                        !validation.isJjRepo ||
                        validation.brokenMetadata ||
                        validation.startupError
                    ) {
                        recoveryError =
                            validation.startupError ??
                            "The recovered repository did not pass validation"
                    }
                }
                if (!recoveryError) {
                    const backupPaths = backupResult.backups.map((entry) => entry.backup)
                    if (options.mode !== "remove") {
                        return { success: true, backups: backupPaths }
                    }

                    const removalStartedAt = reportRecoveryStart(
                        options.sink,
                        "Remove old repository metadata",
                    )
                    const removalError = yield* Effect.promise(() =>
                        removeMetadataBackups(backupResult.backups),
                    )
                    reportRecoveryFinish(options.sink, removalStartedAt, {
                        ...(removalError
                            ? { stderr: `${removalError}\n` }
                            : { stdout: "Removed old repository metadata\n" }),
                        success: removalError === null,
                    })
                    return permanentRemovalResult(backupPaths, removalError)
                }

                const restoreStartedAt = reportRecoveryStart(
                    options.sink,
                    "Restore repository metadata",
                )
                const restoreError = yield* Effect.promise(() =>
                    restoreMetadataBackups(backupResult.backups),
                )
                reportRecoveryFinish(options.sink, restoreStartedAt, {
                    ...(restoreError
                        ? { stderr: `${restoreError}\n` }
                        : { stdout: "Restored repository metadata\n" }),
                    success: restoreError === null,
                })
                return {
                    success: false,
                    error: [
                        recoveryError ?? "jj git init failed",
                        restoreError ? `Failed to restore metadata:\n${restoreError}` : null,
                    ]
                        .filter((message): message is string => message !== null)
                        .join("\n"),
                }
            })

            return RepositoryBootstrap.of({ inspect, initialize, recover })
        }),
    )
