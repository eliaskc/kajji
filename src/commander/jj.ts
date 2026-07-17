import { Context, Effect, Layer, Schema, Stream } from "effect"
import { Hooks, HooksLive } from "../hooks/runner"
import { HookOperation } from "../hooks/types"
import {
    AppProcess,
    type ProcessError,
    type ProcessOutputStream,
    ProcessResult,
} from "../process/app-process"
import {
    OperationInterruptedError,
    type OperationSink,
} from "../process/operation-sink"
export type {
    OperationFailure,
    OperationSink,
} from "../process/operation-sink"
import { findBinaryFiles } from "../utils/diff-binary"
import { isStaleWorkingCopyFailure } from "../utils/error-parser"
import { toFilesetArgs } from "../utils/jj-fileset"
import {
    BOOKMARK_TEMPLATE,
    type Bookmark,
    parseBookmarkOutput,
} from "./bookmarks"
import { parseFileSummary } from "./files"
import {
    type LogPageResult,
    type LogStreamState,
    buildLogArgs,
    buildLogTemplate,
    consumeLogChunk,
    finalizeLogStream,
    parseLogOutput,
} from "./log"
import type { Commit, FileChange } from "./types"

export type JjLogStreamEvent =
    | {
          readonly _tag: "Batch"
          readonly commits: readonly Commit[]
      }
    | {
          readonly _tag: "Complete"
          readonly result: LogPageResult
      }

export interface JjOperationOptions {
    readonly cwd: string
    readonly timeoutMs?: number
    readonly sink?: OperationSink
}

export interface JjGitFetchOptions extends JjOperationOptions {
    readonly allRemotes?: boolean
    readonly tracked?: boolean
    readonly branches?: readonly string[]
    readonly remotes?: readonly string[]
}

export interface JjGitPushOptions extends JjOperationOptions {
    readonly remote?: string
    readonly bookmarks?: readonly string[]
    readonly all?: boolean
    readonly tracked?: boolean
    readonly deleted?: boolean
    readonly allowEmptyDescription?: boolean
    readonly allowPrivate?: boolean
    readonly revisions?: readonly string[]
    readonly changes?: readonly string[]
    readonly dryRun?: boolean
}

export interface JjEditOptions extends JjOperationOptions {
    readonly ignoreImmutable?: boolean
}

export interface JjNewOptions extends JjOperationOptions {
    readonly verify?: boolean
    readonly position?: "before" | "after"
}

export interface JjSquashOptions extends JjOperationOptions {
    readonly into?: string
    readonly useDestinationMessage?: boolean
    readonly keepEmptied?: boolean
    readonly ignoreImmutable?: boolean
}

export interface JjBookmarkReadOptions extends JjOperationOptions {
    readonly allRemotes?: boolean
}

export interface JjLogReadOptions extends JjOperationOptions {
    readonly revset?: string
    readonly limit?: number
}

export type JjDiffTarget =
    | { readonly revision: string }
    | { readonly from: string; readonly to: string }

export interface JjDiffOptions extends JjOperationOptions {
    readonly paths?: readonly string[]
    readonly columns?: number
    readonly color?: boolean
}

export interface JjRestoreOptions extends JjOperationOptions {
    readonly from?: string
    readonly into?: string
}

export interface JjRebaseOptions extends JjOperationOptions {
    readonly mode?: "revision" | "descendants" | "branch"
    readonly targetMode?: "onto" | "insertAfter" | "insertBefore"
    readonly skipEmptied?: boolean
    readonly ignoreImmutable?: boolean
}

export interface JjBookmarkCreateOptions extends JjOperationOptions {
    readonly revision?: string
}

export interface JjBookmarkSetOptions extends JjOperationOptions {
    readonly allowBackwards?: boolean
}

export interface JjOperationResult extends ProcessResult {
    readonly command: string
}

export interface JjDescription {
    readonly subject: string
    readonly body: string
}

export interface JjRefreshState {
    readonly operationId: string
    readonly workingCopyCommitId: string
}

export interface JjCommitDetails {
    readonly subject: string
    readonly body: string
}

export interface JjRevisionSummary {
    readonly changeId: string
    readonly commitId: string
    readonly description: string
}

export class JjStaleWorkingCopyError extends Schema.TaggedErrorClass<JjStaleWorkingCopyError>()(
    "JjStaleWorkingCopyError",
    {
        output: Schema.String,
    },
) {
    override get message() {
        return `The working copy is stale\n${this.output}`
    }
}

export class JjCommandError extends Schema.TaggedErrorClass<JjCommandError>()(
    "JjCommandError",
    {
        command: Schema.String,
        result: ProcessResult,
    },
) {
    override get message() {
        return (
            this.result.stderr ||
            this.result.stdout ||
            `${this.command} failed with exit code ${this.result.exitCode}`
        )
    }
}

const JjReadFailureKind = Schema.Literals([
    "files",
    "file-show",
    "diff",
    "operation-log",
    "bookmarks",
    "log",
    "revisions",
    "repository-root",
])

export type JjReadFailureKind = typeof JjReadFailureKind.Type

export class JjReadError extends Schema.TaggedErrorClass<JjReadError>()(
    "JjReadError",
    {
        kind: JjReadFailureKind,
        command: Schema.String,
        result: ProcessResult,
    },
) {
    override get message() {
        if (this.kind === "repository-root") {
            if (this.result.exitCode === 0) return "Unable to resolve jj root"
            return this.result.stderr.trim() || "Not a jj repository"
        }
        if (this.kind === "revisions") {
            const detail = this.result.stderr.trim()
            return detail ? `jj log failed: ${detail}` : "jj log failed"
        }
        const prefix =
            this.kind === "files"
                ? "Failed to fetch files"
                : this.kind === "file-show"
                  ? "Failed to read file at revision"
                  : this.kind === "operation-log"
                    ? "jj op log failed"
                    : this.kind === "bookmarks"
                      ? "jj bookmark list failed"
                      : this.kind === "log"
                        ? "jj log failed"
                        : "jj diff failed"
        return `${prefix}: ${this.result.stderr}`
    }
}

export interface JjService {
    readonly repositoryRoot: (
        options: JjOperationOptions,
    ) => Effect.Effect<string, JjReadError | ProcessError>
    readonly revisionSummaries: (
        revset: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjRevisionSummary[], JjReadError | ProcessError>
    readonly fileContent: (
        revision: string,
        path: string,
        options: JjOperationOptions,
    ) => Effect.Effect<string, JjReadError | ProcessError>
    readonly checkWorkingCopy: (
        options: JjOperationOptions,
    ) => Effect.Effect<void, JjStaleWorkingCopyError | ProcessError>
    readonly gitInit: (
        options: JjOperationOptions & { readonly colocate?: boolean },
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly gitFetch: (
        options: JjGitFetchOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly gitPush: (
        options: JjGitPushOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly undo: (
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly redo: (
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly opRestore: (
        operationId: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly workspaceUpdateStale: (
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly edit: (
        revision: string,
        options: JjEditOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly describe: (
        revision: string,
        message: string,
        options: JjEditOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly squash: (
        revision: string | undefined,
        options: JjSquashOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly rebase: (
        revision: string,
        destination: string,
        options: JjRebaseOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkCreate: (
        name: string,
        options: JjBookmarkCreateOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkSet: (
        name: string,
        revision: string,
        options: JjBookmarkSetOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkDelete: (
        name: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkRename: (
        oldName: string,
        newName: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly bookmarkForget: (
        name: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly new: (
        revision: string,
        options: JjNewOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly duplicate: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly abandon: (
        revision: string,
        options: JjEditOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly restore: (
        paths: readonly string[],
        options: JjRestoreOptions,
    ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>
    readonly materializeFile: (
        revision: string,
        path: string,
        outputPath: string,
        options: JjOperationOptions,
    ) => Effect.Effect<void, JjReadError | ProcessError>
    readonly isInTrunk: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<boolean, ProcessError>
    readonly showDescription: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjDescription, ProcessError>
    readonly nearestAncestorBookmarkNames: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<string[], JjCommandError | ProcessError>
    readonly operationId: (
        options: JjOperationOptions,
    ) => Effect.Effect<string, JjStaleWorkingCopyError | ProcessError>
    readonly revsetHasMatches: (
        revset: string,
        options: JjOperationOptions,
    ) => Effect.Effect<boolean, ProcessError>
    readonly refreshState: (
        options: JjOperationOptions,
    ) => Effect.Effect<JjRefreshState, JjStaleWorkingCopyError | ProcessError>
    readonly files: (
        target: JjDiffTarget,
        options: JjOperationOptions,
    ) => Effect.Effect<
        FileChange[],
        JjReadError | JjStaleWorkingCopyError | ProcessError
    >
    readonly commitDetails: (
        revision: string,
        options: JjOperationOptions,
    ) => Effect.Effect<JjCommitDetails, ProcessError>
    readonly opLog: (
        limit: number | undefined,
        options: JjOperationOptions,
    ) => Effect.Effect<
        string[],
        JjReadError | JjStaleWorkingCopyError | ProcessError
    >
    readonly diff: (
        target: JjDiffTarget,
        options: JjDiffOptions,
    ) => Effect.Effect<string, JjReadError | ProcessError>
    readonly bookmarks: (
        options: JjBookmarkReadOptions,
    ) => Effect.Effect<
        Bookmark[],
        JjReadError | JjStaleWorkingCopyError | ProcessError
    >
    readonly streamBookmarks: (
        options: JjBookmarkReadOptions,
        onBatch: (bookmarks: readonly Bookmark[]) => void | Promise<void>,
    ) => Effect.Effect<
        Bookmark[],
        JjReadError | JjStaleWorkingCopyError | ProcessError
    >
    readonly logPage: (
        options: JjLogReadOptions,
    ) => Effect.Effect<
        LogPageResult,
        JjReadError | JjStaleWorkingCopyError | ProcessError
    >
    readonly streamLogPage: (
        options: JjLogReadOptions,
    ) => Stream.Stream<
        JjLogStreamEvent,
        JjReadError | JjStaleWorkingCopyError | ProcessError
    >
}

export class Jj extends Context.Service<Jj, JjService>()("kajji/Jj") {}

function notify(fn: () => void) {
    try {
        fn()
    } catch {
        // Operation observation must never affect the command.
    }
}

function makeDiffTargetArgs(target: JjDiffTarget): string[] {
    return "revision" in target
        ? ["-r", target.revision]
        : ["--from", target.from, "--to", target.to]
}

export function makeGitFetchArgs(
    options: Omit<JjGitFetchOptions, keyof JjOperationOptions>,
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

export function makeGitPushArgs(
    options: Omit<JjGitPushOptions, keyof JjOperationOptions>,
): string[] {
    const args = ["git", "push"]
    if (options.remote) args.push("--remote", options.remote)
    for (const bookmark of options.bookmarks ?? []) {
        args.push("--bookmark", bookmark)
    }
    if (options.all) args.push("--all")
    if (options.tracked) args.push("--tracked")
    if (options.deleted) args.push("--deleted")
    if (options.allowEmptyDescription) args.push("--allow-empty-description")
    if (options.allowPrivate) args.push("--allow-private")
    for (const revision of options.revisions ?? []) {
        args.push("--revisions", revision)
    }
    for (const change of options.changes ?? []) {
        args.push("--change", change)
    }
    if (options.dryRun) args.push("--dry-run")
    return args
}

export const JjLayer: Layer.Layer<Jj, never, AppProcess | Hooks> = Layer.effect(
    Jj,
    Effect.gen(function* () {
        const appProcess = yield* AppProcess
        const hooks = yield* Hooks

        const runRaw = Effect.fn("Jj.runRaw")(function* (
            args: readonly string[],
            options: JjOperationOptions,
            runOptions: {
                displayCommand?: string
                env?: Readonly<Record<string, string>>
                stdoutFile?: string
                onOutput?: (
                    stream: ProcessOutputStream,
                    chunk: string,
                ) => void | Promise<void>
            } = {},
        ) {
            const command = runOptions.displayCommand ?? `jj ${args.join(" ")}`
            notify(() => options.sink?.start(command, "jj"))

            const processCommand = {
                executable: "jj",
                args,
                cwd: options.cwd,
                env: {
                    JJ_EDITOR: "true",
                    EDITOR: "true",
                    VISUAL: "true",
                    ...runOptions.env,
                },
                timeoutMs: options.timeoutMs,
                stdoutFile: runOptions.stdoutFile,
                onOutput: async (
                    stream: ProcessOutputStream,
                    chunk: string,
                ) => {
                    notify(() => options.sink?.output(stream, chunk))
                    await runOptions.onOutput?.(stream, chunk)
                },
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
            return { ...result, command }
        })

        const streamRaw = (
            args: readonly string[],
            options: JjOperationOptions,
        ) => {
            const command = `jj ${args.join(" ")}`
            let settled = false
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
            }
            const start = Stream.fromEffect(
                Effect.sync(() =>
                    notify(() => options.sink?.start(command, "jj")),
                ),
            ).pipe(Stream.drain)
            const events = appProcess.stream(processCommand).pipe(
                Stream.map((event) => {
                    if (event._tag === "Output") {
                        notify(() =>
                            options.sink?.output(event.stream, event.chunk),
                        )
                    } else {
                        settled = true
                        notify(() => options.sink?.finish(event.result))
                    }
                    return event
                }),
                Stream.tapError((error) =>
                    Effect.sync(() => {
                        settled = true
                        notify(() => options.sink?.fail(error))
                    }),
                ),
                Stream.ensuring(
                    Effect.sync(() => {
                        if (settled) return
                        notify(() =>
                            options.sink?.fail(
                                new OperationInterruptedError({ command }),
                            ),
                        )
                    }),
                ),
            )
            return {
                command,
                events: start.pipe(Stream.concat(events)),
            }
        }

        const run = Effect.fn("Jj.run")(function* (
            args: readonly string[],
            options: JjOperationOptions,
            displayCommand?: string,
        ) {
            const result = yield* runRaw(args, options, { displayCommand })
            if (result.exitCode !== 0) {
                return yield* new JjCommandError({
                    command: result.command,
                    result,
                })
            }
            return result
        })

        const throwIfStale = (result: JjOperationResult) => {
            const output = result.stdout + result.stderr
            if (isStaleWorkingCopyFailure(result)) {
                return Effect.fail(new JjStaleWorkingCopyError({ output }))
            }
            return Effect.void
        }

        const checkWorkingCopy = Effect.fn("Jj.checkWorkingCopy")(function* (
            options: JjOperationOptions,
        ) {
            const result = yield* runRaw(["status"], options)
            if (isStaleWorkingCopyFailure(result)) {
                return yield* new JjStaleWorkingCopyError({
                    output: result.stdout + result.stderr,
                })
            }
        })

        const readOpLogId = Effect.fn("Jj.opLogId")(function* (
            options: JjOperationOptions,
        ) {
            const result = yield* runRaw(
                [
                    "op",
                    "log",
                    "--limit",
                    "1",
                    "--no-graph",
                    "--ignore-working-copy",
                    "-T",
                    "self.id()",
                ],
                options,
            )
            yield* throwIfStale(result)
            return result.exitCode === 0 ? result.stdout.trim() : ""
        })

        const readWorkingCopyCommitId = Effect.fn("Jj.workingCopyCommitId")(
            function* (options: JjOperationOptions) {
                const result = yield* runRaw(
                    [
                        "log",
                        "--limit",
                        "1",
                        "--no-graph",
                        "-r",
                        "@",
                        "-T",
                        "commit_id",
                    ],
                    options,
                )
                yield* throwIfStale(result)
                return result.exitCode === 0
                    ? result.stdout
                          .replace(
                              // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence
                              /\x1b\[[0-9;]*m/g,
                              "",
                          )
                          .trim()
                    : ""
            },
        )

        const readDiff = Effect.fn("Jj.diff")(function* (
            args: string[],
            options: JjDiffOptions,
        ) {
            if (options.paths?.length) {
                args.push(...toFilesetArgs([...options.paths]))
            }
            const result = yield* runRaw(args, options, {
                env: options.columns
                    ? { COLUMNS: String(options.columns) }
                    : undefined,
            })
            if (result.exitCode !== 0) {
                return yield* new JjReadError({
                    kind: "diff",
                    command: result.command,
                    result,
                })
            }
            return result.stdout
        })

        const readFiles = Effect.fn("Jj.files")(function* (
            summaryArgs: readonly string[],
            binaryArgs: readonly string[],
            options: JjOperationOptions,
        ) {
            const [summaryResult, binaryResult] = yield* Effect.all(
                [runRaw(summaryArgs, options), runRaw(binaryArgs, options)],
                { concurrency: "unbounded" },
            )
            yield* throwIfStale(summaryResult)
            yield* throwIfStale(binaryResult)
            if (summaryResult.exitCode !== 0) {
                return yield* new JjReadError({
                    kind: "files",
                    command: summaryResult.command,
                    result: summaryResult,
                })
            }

            const binaryFiles =
                binaryResult.exitCode === 0
                    ? findBinaryFiles(binaryResult.stdout)
                    : new Set<string>()
            return parseFileSummary(summaryResult.stdout).map((file) => ({
                ...file,
                isBinary: binaryFiles.has(file.path),
            }))
        })

        return Jj.of({
            repositoryRoot: Effect.fn("Jj.repositoryRoot")(function* (
                options: JjOperationOptions,
            ) {
                const result = yield* runRaw(["root"], options)
                const root = result.stdout.trim()
                if (result.exitCode !== 0 || root.length === 0) {
                    return yield* new JjReadError({
                        kind: "repository-root",
                        command: result.command,
                        result,
                    })
                }
                return root
            }),
            revisionSummaries: Effect.fn("Jj.revisionSummaries")(function* (
                revset: string,
                options: JjOperationOptions,
            ) {
                const template =
                    'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ description.first_line()'
                const result = yield* runRaw(
                    ["log", "-r", revset, "--no-graph", "-T", template],
                    options,
                )
                if (result.exitCode !== 0) {
                    return yield* new JjReadError({
                        kind: "revisions",
                        command: result.command,
                        result,
                    })
                }
                return result.stdout
                    .split("\n")
                    .filter((line) => line.trim().length > 0)
                    .map((line) => {
                        const parts = line.split("\t")
                        return {
                            changeId: parts[0] ?? "",
                            commitId: parts[1] ?? "",
                            description:
                                parts.slice(2).join("\t") ||
                                "(no description set)",
                        }
                    })
            }),
            fileContent: Effect.fn("Jj.fileContent")(function* (
                revision: string,
                path: string,
                options: JjOperationOptions,
            ) {
                const result = yield* runRaw(
                    ["file", "show", "-r", revision, path],
                    options,
                )
                if (result.exitCode !== 0) {
                    return yield* new JjReadError({
                        kind: "file-show",
                        command: result.command,
                        result,
                    })
                }
                return result.stdout
            }),
            checkWorkingCopy,
            gitInit: Effect.fn("Jj.gitInit")(
                (
                    options: JjOperationOptions & {
                        readonly colocate?: boolean
                    },
                ) =>
                    run(
                        [
                            "git",
                            "init",
                            ...(options.colocate ? ["--colocate"] : []),
                        ],
                        options,
                    ),
            ),
            gitFetch: Effect.fn("Jj.gitFetch")((options: JjGitFetchOptions) =>
                run(makeGitFetchArgs(options), options),
            ),
            gitPush: Effect.fn("Jj.gitPush")((options: JjGitPushOptions) =>
                run(makeGitPushArgs(options), options),
            ),
            undo: Effect.fn("Jj.undo")((options: JjOperationOptions) =>
                run(["undo"], options),
            ),
            redo: Effect.fn("Jj.redo")((options: JjOperationOptions) =>
                run(["redo"], options),
            ),
            opRestore: Effect.fn("Jj.opRestore")(
                (operationId: string, options: JjOperationOptions) =>
                    run(["op", "restore", operationId], options),
            ),
            workspaceUpdateStale: Effect.fn("Jj.workspaceUpdateStale")(
                (options: JjOperationOptions) =>
                    run(["workspace", "update-stale"], options),
            ),
            edit: Effect.fn("Jj.edit")(
                (revision: string, options: JjEditOptions) =>
                    run(
                        [
                            "edit",
                            revision,
                            ...(options.ignoreImmutable
                                ? ["--ignore-immutable"]
                                : []),
                        ],
                        options,
                    ),
            ),
            describe: Effect.fn("Jj.describe")(
                (revision: string, message: string, options: JjEditOptions) =>
                    run(
                        [
                            "describe",
                            revision,
                            "-m",
                            message,
                            ...(options.ignoreImmutable
                                ? ["--ignore-immutable"]
                                : []),
                        ],
                        options,
                        `jj describe ${revision} -m "..."`,
                    ),
            ),
            squash: Effect.fn("Jj.squash")(
                (revision: string | undefined, options: JjSquashOptions) => {
                    const args = ["squash"]
                    if (options.into) {
                        if (revision) args.push("--from", revision)
                        args.push("--into", options.into)
                    } else if (revision) {
                        args.push("-r", revision)
                    }
                    if (options.useDestinationMessage) args.push("-u")
                    if (options.keepEmptied) args.push("-k")
                    if (options.ignoreImmutable) args.push("--ignore-immutable")
                    return run(args, options)
                },
            ),
            rebase: Effect.fn("Jj.rebase")(
                (
                    revision: string,
                    destination: string,
                    options: JjRebaseOptions,
                ) => {
                    const args = ["rebase"]
                    if (options.mode === "descendants")
                        args.push("-s", revision)
                    else if (options.mode === "branch")
                        args.push("-b", revision)
                    else args.push("-r", revision)

                    if (options.targetMode === "insertAfter")
                        args.push("-A", destination)
                    else if (options.targetMode === "insertBefore")
                        args.push("-B", destination)
                    else args.push("-d", destination)

                    if (options.skipEmptied) args.push("--skip-emptied")
                    if (options.ignoreImmutable) args.push("--ignore-immutable")
                    return run(args, options)
                },
            ),
            bookmarkCreate: Effect.fn("Jj.bookmarkCreate")(
                (name: string, options: JjBookmarkCreateOptions) =>
                    run(
                        [
                            "bookmark",
                            "create",
                            name,
                            ...(options.revision
                                ? ["-r", options.revision]
                                : []),
                        ],
                        options,
                    ),
            ),
            bookmarkSet: Effect.fn("Jj.bookmarkSet")(
                (
                    name: string,
                    revision: string,
                    options: JjBookmarkSetOptions,
                ) =>
                    run(
                        [
                            "bookmark",
                            "set",
                            name,
                            "-r",
                            revision,
                            ...(options.allowBackwards
                                ? ["--allow-backwards"]
                                : []),
                        ],
                        options,
                    ),
            ),
            bookmarkDelete: Effect.fn("Jj.bookmarkDelete")(
                (name: string, options: JjOperationOptions) =>
                    run(["bookmark", "delete", name], options),
            ),
            bookmarkRename: Effect.fn("Jj.bookmarkRename")(
                (
                    oldName: string,
                    newName: string,
                    options: JjOperationOptions,
                ) => run(["bookmark", "rename", oldName, newName], options),
            ),
            bookmarkForget: Effect.fn("Jj.bookmarkForget")(
                (name: string, options: JjOperationOptions) =>
                    run(["bookmark", "forget", name], options),
            ),
            new: Effect.fn("Jj.new")(function* (
                revision: string,
                options: JjNewOptions,
            ) {
                const hookResult = yield* hooks.runApplicablePreHooks(
                    HookOperation.JjNew,
                    options,
                )
                if (!hookResult.success) {
                    notify(() =>
                        options.sink?.skip(
                            "jj new skipped because pre-hook failed",
                        ),
                    )
                    return {
                        ...hookResult.result,
                        command: `hook jj.new: ${hookResult.command}`,
                    }
                }

                const args = ["new"]
                if (options.position === "before") args.push("-B")
                else if (options.position === "after") args.push("-A")
                args.push(revision)
                return yield* run(args, options)
            }),
            duplicate: Effect.fn("Jj.duplicate")(
                (revision: string, options: JjOperationOptions) =>
                    run(["duplicate", revision], options),
            ),
            abandon: Effect.fn("Jj.abandon")(
                (revision: string, options: JjEditOptions) =>
                    run(
                        [
                            "abandon",
                            revision,
                            ...(options.ignoreImmutable
                                ? ["--ignore-immutable"]
                                : []),
                        ],
                        options,
                    ),
            ),
            restore: Effect.fn("Jj.restore")(
                (paths: readonly string[], options: JjRestoreOptions) =>
                    run(
                        [
                            "restore",
                            ...(options.from ? ["--from", options.from] : []),
                            ...(options.into ? ["--into", options.into] : []),
                            ...paths,
                        ],
                        options,
                    ),
            ),
            materializeFile: Effect.fn("Jj.materializeFile")(function* (
                revision: string,
                path: string,
                outputPath: string,
                options: JjOperationOptions,
            ) {
                const result = yield* runRaw(
                    ["file", "show", "-r", revision, path],
                    options,
                    { stdoutFile: outputPath },
                )
                if (result.exitCode !== 0) {
                    return yield* new JjReadError({
                        kind: "file-show",
                        command: result.command,
                        result,
                    })
                }
            }),
            isInTrunk: Effect.fn("Jj.isInTrunk")(function* (
                revision: string,
                options: JjOperationOptions,
            ) {
                const result = yield* runRaw(
                    [
                        "log",
                        "-r",
                        `${revision} & ::trunk()`,
                        "--no-graph",
                        "-T",
                        "change_id",
                    ],
                    options,
                )
                return result.exitCode === 0 && result.stdout.trim().length > 0
            }),
            showDescription: Effect.fn("Jj.showDescription")(function* (
                revision: string,
                options: JjOperationOptions,
            ) {
                const result = yield* runRaw(
                    ["log", "-r", revision, "--no-graph", "-T", "description"],
                    options,
                )
                if (result.exitCode !== 0) return { subject: "", body: "" }
                const lines = result.stdout.trim().split("\n")
                return {
                    subject: lines[0] ?? "",
                    body: lines.slice(1).join("\n").trim(),
                }
            }),
            operationId: readOpLogId,
            revsetHasMatches: Effect.fn("Jj.revsetHasMatches")(function* (
                revset: string,
                options: JjOperationOptions,
            ) {
                const result = yield* runRaw(
                    [
                        "log",
                        "-r",
                        revset,
                        "--limit",
                        "1",
                        "--no-graph",
                        "-T",
                        "commit_id",
                    ],
                    options,
                )
                return result.exitCode === 0 && result.stdout.trim().length > 0
            }),
            nearestAncestorBookmarkNames: Effect.fn(
                "Jj.nearestAncestorBookmarkNames",
            )(function* (revision: string, options: JjOperationOptions) {
                const revset = `heads(::${revision} & bookmarks())`
                const result = yield* run(
                    [
                        "bookmark",
                        "list",
                        "-r",
                        revset,
                        "--template",
                        'name ++ "\\n"',
                    ],
                    options,
                )
                return result.stdout
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
            }),
            refreshState: Effect.fn("Jj.refreshState")(function* (
                options: JjOperationOptions,
            ) {
                yield* checkWorkingCopy(options)
                const [operationId, workingCopyCommitId] = yield* Effect.all(
                    [readOpLogId(options), readWorkingCopyCommitId(options)],
                    { concurrency: "unbounded" },
                )
                return { operationId, workingCopyCommitId }
            }),
            files: Effect.fn("Jj.files")(
                (target: JjDiffTarget, options: JjOperationOptions) => {
                    const targetArgs = makeDiffTargetArgs(target)
                    return readFiles(
                        ["diff", "--summary", ...targetArgs],
                        ["diff", "--git", ...targetArgs],
                        options,
                    )
                },
            ),
            commitDetails: Effect.fn("Jj.commitDetails")(function* (
                revision: string,
                options: JjOperationOptions,
            ) {
                const separator = "\n---KAJJI_DETAILS_SEPARATOR---\n"
                const styledSubjectTemplate = `if(empty, label("empty", "(empty) "), "") ++ if(description.first_line(), description.first_line(), label("description placeholder", "(no description set)"))`
                const result = yield* runRaw(
                    [
                        "log",
                        "-r",
                        revision,
                        "--no-graph",
                        "--color",
                        "always",
                        "-T",
                        `${styledSubjectTemplate} ++ "${separator}" ++ description`,
                    ],
                    options,
                )
                if (result.exitCode !== 0) return { subject: "", body: "" }
                const parts = result.stdout.split(separator)
                const description = (parts[1] ?? "").trim().split("\n")
                return {
                    subject: (parts[0] ?? "").trim(),
                    body: description.slice(1).join("\n").trim(),
                }
            }),
            opLog: Effect.fn("Jj.opLog")(function* (
                limit: number | undefined,
                options: JjOperationOptions,
            ) {
                const args = [
                    "op",
                    "log",
                    "--color",
                    "always",
                    "--ignore-working-copy",
                ]
                if (limit) args.push("--limit", String(limit))
                const result = yield* runRaw(args, options)
                yield* throwIfStale(result)
                if (result.exitCode !== 0) {
                    return yield* new JjReadError({
                        kind: "operation-log",
                        command: result.command,
                        result,
                    })
                }
                return result.stdout.split("\n")
            }),
            diff: Effect.fn("Jj.diff")(
                (target: JjDiffTarget, options: JjDiffOptions) =>
                    readDiff(
                        [
                            "diff",
                            ...makeDiffTargetArgs(target),
                            ...(options.color
                                ? ["--color", "always"]
                                : ["--git"]),
                        ],
                        options,
                    ),
            ),
            bookmarks: Effect.fn("Jj.bookmarks")(function* (
                options: JjBookmarkReadOptions,
            ) {
                const args = [
                    "--color",
                    "always",
                    "bookmark",
                    "list",
                    "--sort",
                    "committer-date-",
                    "--template",
                    BOOKMARK_TEMPLATE,
                ]
                if (options.allRemotes) args.push("--all-remotes")
                const result = yield* runRaw(args, options)
                yield* throwIfStale(result)
                if (result.exitCode !== 0) {
                    return yield* new JjReadError({
                        kind: "bookmarks",
                        command: result.command,
                        result,
                    })
                }
                return parseBookmarkOutput(result.stdout)
            }),
            streamBookmarks: Effect.fn("Jj.streamBookmarks")(function* (
                options: JjBookmarkReadOptions,
                onBatch: (
                    bookmarks: readonly Bookmark[],
                ) => void | Promise<void>,
            ) {
                const args = [
                    "--color",
                    "always",
                    "bookmark",
                    "list",
                    "--sort",
                    "committer-date-",
                    "--template",
                    BOOKMARK_TEMPLATE,
                ]
                if (options.allRemotes) args.push("--all-remotes")

                let output = ""
                let lastCount = 0
                const result = yield* runRaw(args, options, {
                    onOutput: async (stream, chunk) => {
                        if (stream !== "stdout") return
                        output += chunk
                        const completeEnd = output.lastIndexOf("\n")
                        if (completeEnd < 0) return
                        const bookmarks = parseBookmarkOutput(
                            output.slice(0, completeEnd + 1),
                        )
                        if (bookmarks.length <= lastCount) return
                        lastCount = bookmarks.length
                        await onBatch(bookmarks)
                    },
                })
                yield* throwIfStale(result)
                if (result.exitCode !== 0) {
                    return yield* new JjReadError({
                        kind: "bookmarks",
                        command: result.command,
                        result,
                    })
                }
                return parseBookmarkOutput(result.stdout)
            }),
            logPage: Effect.fn("Jj.logPage")(function* (
                options: JjLogReadOptions,
            ) {
                const commandLimit = options.limit
                    ? options.limit + 1
                    : undefined
                const result = yield* runRaw(
                    buildLogArgs(options, buildLogTemplate(), commandLimit),
                    options,
                )
                yield* throwIfStale(result)
                if (result.exitCode !== 0) {
                    return yield* new JjReadError({
                        kind: "log",
                        command: result.command,
                        result,
                    })
                }
                const commits = parseLogOutput(result.stdout)
                if (options.limit && commits.length > options.limit) {
                    return {
                        commits: commits.slice(0, options.limit),
                        hasMore: true,
                    }
                }
                return { commits, hasMore: false }
            }),
            streamLogPage: (options: JjLogReadOptions) =>
                Stream.suspend(() => {
                    const commandLimit = options.limit
                        ? options.limit + 1
                        : undefined
                    const maxCommits = commandLimit ?? Number.POSITIVE_INFINITY
                    const state: LogStreamState = {
                        buffer: "",
                        current: null,
                    }
                    const commits: Commit[] = []
                    let lastBatchAt = 0

                    const append = (next: readonly Commit[]) => {
                        for (const commit of next) {
                            if (commits.length >= maxCommits) break
                            commits.push(commit)
                        }
                    }
                    const visible = () =>
                        options.limit
                            ? commits.slice(0, options.limit)
                            : commits.slice()
                    const { command, events } = streamRaw(
                        buildLogArgs(options, buildLogTemplate(), commandLimit),
                        options,
                    )

                    return events.pipe(
                        Stream.flatMap((event) => {
                            if (event._tag === "Output") {
                                if (event.stream !== "stdout")
                                    return Stream.empty
                                const previousLength = commits.length
                                append(consumeLogChunk(event.chunk, state))
                                const now = performance.now()
                                if (
                                    commits.length > previousLength &&
                                    (lastBatchAt === 0 ||
                                        now - lastBatchAt >= 25)
                                ) {
                                    lastBatchAt = now
                                    return Stream.succeed<JjLogStreamEvent>({
                                        _tag: "Batch",
                                        commits: visible(),
                                    })
                                }
                                return Stream.empty
                            }

                            const result = {
                                ...event.result,
                                command,
                            }
                            return Stream.fromEffect(
                                Effect.gen(function* () {
                                    yield* throwIfStale(result)
                                    if (result.exitCode !== 0) {
                                        return yield* new JjReadError({
                                            kind: "log",
                                            command,
                                            result,
                                        })
                                    }
                                    append(finalizeLogStream(state))
                                    return {
                                        _tag: "Complete" as const,
                                        result: {
                                            commits: visible(),
                                            hasMore: options.limit
                                                ? commits.length > options.limit
                                                : false,
                                        },
                                    }
                                }),
                            )
                        }),
                        Stream.withSpan("Jj.streamLogPage"),
                    )
                }),
        })
    }),
)

export const JjLive = JjLayer.pipe(Layer.provide(HooksLive))
