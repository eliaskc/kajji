import { randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, rmdir } from "node:fs/promises"
import { basename, dirname, join, relative, resolve } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Git } from "./commander/git"
import { Jj, type JjCommandError, type JjRefreshState, type OperationSink } from "./commander/jj"
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
    readonly refreshState?: JjRefreshState
}

export interface RepositoryInitResult {
    readonly success: boolean
    readonly error?: string
}

export type RepositoryRecoveryMode = "backup" | "remove"

export interface RepositoryRecoveryResult extends RepositoryInitResult {
    readonly backups?: readonly string[]
    readonly warning?: string
    /** Folder that keeps the old metadata after a successful backup recovery. */
    readonly backupDirectory?: string
    readonly refreshState?: JjRefreshState
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
        sink?.start(label, "step")
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
        if (await isDirectory(join(candidate, ".jj"))) return candidate
        const parent = dirname(candidate)
        if (parent === candidate) return undefined
        candidate = parent
    }
}

async function hasProvablyBrokenJjMarker(path: string): Promise<boolean> {
    const marker = join(path, ".jj")
    if (!(await isDirectory(marker))) return false
    const repo = join(marker, "repo")
    // Secondary workspaces store the main repository path in a `.jj/repo` file. Their
    // metadata lives elsewhere, so recovery here cannot prove anything.
    if ((await pathExists(repo)) && !(await isDirectory(repo))) return false
    return !(await pathExists(join(repo, "store", "type")))
}

async function hasProvablyBrokenGitMarker(path: string): Promise<boolean> {
    const marker = join(path, ".git")
    return (await isDirectory(marker)) && !(await pathExists(join(marker, "HEAD")))
}

/** Folder inside the new `.jj` that keeps old metadata. jj never snapshots `.jj`. */
export const RECOVERY_BACKUP_DIRECTORY = "kajji-backups"

function recoveryId(): string {
    // e.g. 20260923-194901-fd60a9 (UTC). Sorts by time and stays short in the log.
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-")
    return `${timestamp}-${randomUUID().slice(0, 6)}`
}

/**
 * Old metadata must leave `.jj`/`.git` before `jj git init` can run. It waits beside them
 * only until init completes; `jj git init` does not snapshot, so the staged folders are
 * moved into the new `.jj` before any command can add them to the working copy.
 */
function stagingPath(original: string, id: string): string {
    return `${original}.kajji-recovery-${id}`
}

export function archivePath(repositoryPath: string, original: string, id: string): string {
    return join(repositoryPath, ".jj", RECOVERY_BACKUP_DIRECTORY, id, basename(original).slice(1))
}

/** Applies moves in order. On failure, moves the completed ones back and returns the error. */
export async function applyMoves(
    moves: readonly MetadataBackup[],
    filesystem: MetadataFilesystem = metadataFilesystem,
): Promise<string | null> {
    const completed: MetadataBackup[] = []
    try {
        for (const move of moves) {
            await filesystem.rename(move.original, move.backup)
            completed.push(move)
        }
        return null
    } catch (error) {
        for (const move of completed.toReversed()) {
            await filesystem.rename(move.backup, move.original).catch(() => undefined)
        }
        return unknownErrorMessage(error)
    }
}

function invertMoves(moves: readonly MetadataBackup[]): MetadataBackup[] {
    return moves.map((move) => ({ original: move.backup, backup: move.original })).toReversed()
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

function joinErrors(...messages: readonly (string | null)[]): string {
    return messages.filter((message): message is string => message !== null).join("\n")
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
                          .refreshState({
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
                                      refreshState: undefined,
                                  }),
                                  onSuccess: (refreshState) => ({
                                      isJjRepo: true,
                                      startupError: null,
                                      refreshState,
                                  }),
                              }),
                          )
                    : { isJjRepo: false, startupError: null, refreshState: undefined }
                // Only a failing jj or git command plus a malformed marker counts as broken.
                const jjFailed = jjRoot === undefined || jjStatus.startupError !== null
                const brokenMetadata = yield* Effect.promise(async () => ({
                    jj: jjFailed && (await hasProvablyBrokenJjMarker(repoPath)),
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
                    refreshState: brokenMetadata.jj ? undefined : jjStatus.refreshState,
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

                const repoPath = status.repoPath
                const id = recoveryId()
                const reportStep = function* (
                    label: string,
                    run: () => Promise<string | null>,
                    successOutput = "",
                ) {
                    const startedAt = reportRecoveryStart(options.sink, label)
                    const error = yield* Effect.promise(run)
                    reportRecoveryFinish(options.sink, startedAt, {
                        ...(error ? { stderr: `${error}\n` } : { stdout: successOutput }),
                        success: error === null,
                    })
                    return error
                }
                const restore = function* (staged: readonly MetadataBackup[], cause: string) {
                    const restoreError = yield* reportStep("Restore old metadata", () =>
                        restoreMetadataBackups(staged),
                    )
                    return {
                        success: false,
                        error: restoreError
                            ? joinErrors(
                                  cause,
                                  `Could not restore the old metadata: ${restoreError}`,
                              )
                            : joinErrors(cause, "Nothing was changed."),
                    }
                }

                const staged = [
                    ...(brokenMetadata.jj ? [join(repoPath, ".jj")] : []),
                    ...(brokenMetadata.git ? [join(repoPath, ".git")] : []),
                ].map((original) => ({ original, backup: stagingPath(original, id) }))
                const markerNames = staged.map((entry) => basename(entry.original)).join(" and ")
                const stageError = yield* reportStep(`Move ${markerNames} aside`, () =>
                    applyMoves(staged),
                )
                if (stageError) {
                    return {
                        success: false,
                        error: joinErrors(
                            `Could not move ${markerNames}: ${stageError}`,
                            "Nothing was changed.",
                        ),
                    }
                }

                const initResult = yield* initialize(repoPath, options)
                if (!initResult.success) {
                    return yield* restore(
                        staged,
                        ("error" in initResult ? initResult.error : undefined) ??
                            "jj git init failed",
                    )
                }

                // Move the old metadata into the new `.jj` before anything snapshots.
                const archived = staged.map((entry) => ({
                    original: entry.backup,
                    backup: archivePath(repoPath, entry.original, id),
                }))
                const archiveRoot = dirname(archived[0]!.backup)
                const archiveError = yield* reportStep(
                    options.mode === "remove"
                        ? "Keep old metadata until the check passes"
                        : "Back up old metadata",
                    async () => {
                        try {
                            await mkdir(archiveRoot, { recursive: true })
                        } catch (error) {
                            return unknownErrorMessage(error)
                        }
                        return applyMoves(archived)
                    },
                    `${relative(repoPath, archiveRoot)}/\n`,
                )
                if (archiveError) {
                    return yield* restore(
                        staged,
                        `Could not move the old metadata into .jj: ${archiveError}`,
                    )
                }

                const checkStartedAt = reportRecoveryStart(options.sink, "Check new repository")
                const validation = yield* inspect(repoPath)
                const validationError =
                    validation.isJjRepo && !validation.brokenMetadata && !validation.startupError
                        ? null
                        : (validation.startupError ?? "jj cannot open the new repository")
                reportRecoveryFinish(options.sink, checkStartedAt, {
                    ...(validationError ? { stderr: `${validationError}\n` } : {}),
                    success: validationError === null,
                })
                if (validationError) {
                    const unarchiveError = yield* Effect.promise(() =>
                        applyMoves(invertMoves(archived)),
                    )
                    if (unarchiveError) {
                        return {
                            success: false,
                            error: joinErrors(
                                validationError,
                                `Could not restore the old metadata: ${unarchiveError}`,
                                `The old metadata is in ${archiveRoot}`,
                            ),
                        }
                    }
                    return yield* restore(staged, validationError)
                }

                const backupPaths = archived.map((entry) => entry.backup)
                if (options.mode !== "remove") {
                    return {
                        success: true,
                        backups: backupPaths,
                        backupDirectory: archiveRoot,
                        refreshState: validation.refreshState,
                    }
                }

                const removalError = yield* reportStep("Delete old metadata", async () => {
                    const error = await removeMetadataBackups([
                        { original: archiveRoot, backup: archiveRoot },
                    ])
                    await rmdir(dirname(archiveRoot)).catch(() => undefined)
                    return error
                })
                return {
                    ...permanentRemovalResult(backupPaths, removalError),
                    refreshState: validation.refreshState,
                }
            })

            return RepositoryBootstrap.of({ inspect, initialize, recover })
        }),
    )
