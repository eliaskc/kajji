import { Effect, Layer, ManagedRuntime } from "effect"
import type { Bookmark } from "../commander/bookmarks"
import { GitLive } from "../commander/git"
import type { GitHubPullRequestSummary } from "../commander/github"
import {
    GitHub,
    GitHubLive,
    type GitHubOperationResult,
    type GitHubService,
} from "../commander/github-service"
import {
    InteractiveJj,
    InteractiveJjLive,
    type InteractiveJjOptions,
    type InteractiveJjResolveOptions,
    type InteractiveJjResult,
    type InteractiveJjService,
    type InteractiveJjSquashOptions,
} from "../commander/interactive-jj"
import {
    Jj,
    type JjBookmarkCreateOptions,
    type JjBookmarkReadOptions,
    type JjBookmarkSetOptions,
    type JjCommandError,
    type JjCommitDetails,
    type JjDescription,
    type JjDiffOptions,
    type JjDiffTarget,
    type JjEditOptions,
    type JjGitFetchOptions,
    type JjGitPushOptions,
    JjLayer,
    type JjLogReadOptions,
    type JjNewOptions,
    type JjOperationOptions,
    type JjOperationResult,
    type JjRebaseOptions,
    type JjRefreshState,
    type JjRestoreOptions,
    type JjRevisionSummary,
    type JjService,
    type JjSquashOptions,
    type OperationFailure,
    type OperationSink,
} from "../commander/jj"
import type { LogPageResult } from "../commander/log"
import type { CommandObserver } from "../commander/observer"
import type { Commit, FileChange } from "../commander/types"
import { Hooks, HooksLive, type HooksService } from "../hooks/runner"
import type { HookOperationId } from "../hooks/types"
import { AppProcessLive, type ProcessError } from "../process/app-process"
import {
    type InteractiveProcess,
    InteractiveProcessLive,
    type InteractiveProcessSpawnError,
} from "../process/interactive-process"
import type { OperationResult } from "../process/operation-result"
import {
    RepositoryBootstrap,
    RepositoryBootstrapLive,
    type RepositoryBootstrapService,
    type RepositoryInitResult,
    type RepositoryStatus,
} from "../repository-bootstrap"
import { Stack, StackLive, type StackService } from "../stack/executor"
import type { StackPlan } from "../stack/model"
import { type StackStore, StackStoreLive } from "../stack/store"
import { diagnosticsLog } from "../utils/diagnostics"
import { makeHistoricalFileStore } from "./historical-files"

interface ApplicationOperationOptions extends Omit<JjOperationOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationReadOptions extends Omit<JjOperationOptions, "sink"> {
    readonly signal?: AbortSignal
}

interface ApplicationGitHubOperationOptions extends ApplicationReadOptions {
    readonly observer?: CommandObserver
}

interface ApplicationStackOptions extends ApplicationReadOptions {
    readonly observer?: CommandObserver
}

interface ApplicationDiffOptions extends Omit<JjDiffOptions, "sink"> {
    readonly signal?: AbortSignal
}

interface ApplicationBookmarkReadOptions
    extends Omit<JjBookmarkReadOptions, "sink"> {
    readonly signal?: AbortSignal
}

interface ApplicationLogReadOptions extends Omit<JjLogReadOptions, "sink"> {
    readonly signal?: AbortSignal
}

export interface ApplicationStreamHandle<A> {
    readonly result: Promise<A>
    readonly cancel: () => void
}

export interface ApplicationGitFetchOptions
    extends Omit<JjGitFetchOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

export interface ApplicationGitPushOptions
    extends Omit<JjGitPushOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationNewOptions
    extends Omit<JjNewOptions, "sink" | "position"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationEditOptions extends Omit<JjEditOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationSquashOptions extends Omit<JjSquashOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationInteractiveOptions extends InteractiveJjOptions {
    readonly signal?: AbortSignal
}

interface ApplicationInteractiveResolveOptions
    extends InteractiveJjResolveOptions {
    readonly signal?: AbortSignal
}

interface ApplicationInteractiveSquashOptions
    extends InteractiveJjSquashOptions {
    readonly signal?: AbortSignal
}

export interface ApplicationInteractiveResult {
    readonly success: boolean
    readonly error?: string
}

interface ApplicationRestoreOptions extends Omit<JjRestoreOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationRebaseOptions extends Omit<JjRebaseOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationBookmarkCreateOptions
    extends Omit<JjBookmarkCreateOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

interface ApplicationBookmarkSetOptions
    extends Omit<JjBookmarkSetOptions, "sink"> {
    readonly observer?: CommandObserver
    readonly signal?: AbortSignal
}

export interface ApplicationClient {
    readonly repositoryStatus: (
        path: string,
        options?: { readonly signal?: AbortSignal },
    ) => Promise<RepositoryStatus>
    readonly initializeRepository: (
        path: string,
        options?: {
            readonly colocate?: boolean
            readonly signal?: AbortSignal
        },
    ) => Promise<RepositoryInitResult>
    readonly jjGitFetch: (
        options: ApplicationGitFetchOptions,
    ) => Promise<OperationResult>
    readonly jjGitPush: (
        options: ApplicationGitPushOptions,
    ) => Promise<OperationResult>
    readonly jjUndo: (
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjRedo: (
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjOpRestore: (
        operationId: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjWorkspaceUpdateStale: (
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjEdit: (
        revision: string,
        options: ApplicationEditOptions,
    ) => Promise<OperationResult>
    readonly jjDescribe: (
        revision: string,
        message: string,
        options: ApplicationEditOptions,
    ) => Promise<OperationResult>
    readonly jjSquash: (
        revision: string | undefined,
        options: ApplicationSquashOptions,
    ) => Promise<OperationResult>
    readonly jjSplitInteractive: (
        revision: string,
        options: ApplicationInteractiveOptions,
    ) => Promise<ApplicationInteractiveResult>
    readonly jjResolveInteractive: (
        options: ApplicationInteractiveResolveOptions,
    ) => Promise<ApplicationInteractiveResult>
    readonly jjSquashInteractive: (
        revision: string,
        options: ApplicationInteractiveSquashOptions,
    ) => Promise<ApplicationInteractiveResult>
    readonly jjRebase: (
        revision: string,
        destination: string,
        options: ApplicationRebaseOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkCreate: (
        name: string,
        options: ApplicationBookmarkCreateOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkSet: (
        name: string,
        revision: string,
        options: ApplicationBookmarkSetOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkDelete: (
        name: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkRename: (
        oldName: string,
        newName: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjBookmarkForget: (
        name: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjNew: (
        revision: string,
        options: ApplicationNewOptions,
    ) => Promise<OperationResult>
    readonly jjNewBefore: (
        revision: string,
        options: ApplicationNewOptions,
    ) => Promise<OperationResult>
    readonly jjNewAfter: (
        revision: string,
        options: ApplicationNewOptions,
    ) => Promise<OperationResult>
    readonly hasPreHooks: (
        operationId: HookOperationId,
        options: ApplicationReadOptions,
    ) => Promise<boolean>
    readonly jjDuplicate: (
        revision: string,
        options: ApplicationOperationOptions,
    ) => Promise<OperationResult>
    readonly jjAbandon: (
        revision: string,
        options: ApplicationEditOptions,
    ) => Promise<OperationResult>
    readonly jjRestore: (
        paths: readonly string[],
        options: ApplicationRestoreOptions,
    ) => Promise<OperationResult>
    readonly jjMaterializeFiles: (
        revision: string,
        paths: readonly string[],
        options: ApplicationReadOptions,
    ) => Promise<string[]>
    readonly jjRepositoryRoot: (
        options: ApplicationReadOptions,
    ) => Promise<string>
    readonly jjRevisionSummaries: (
        revset: string,
        options: ApplicationReadOptions,
    ) => Promise<JjRevisionSummary[]>
    readonly jjFileContent: (
        revision: string,
        path: string,
        options: ApplicationReadOptions,
    ) => Promise<string>
    readonly jjIsInTrunk: (
        revision: string,
        options: ApplicationReadOptions,
    ) => Promise<boolean>
    readonly jjShowDescription: (
        revision: string,
        options: ApplicationReadOptions,
    ) => Promise<JjDescription>
    readonly jjNearestAncestorBookmarkNames: (
        revision: string,
        options: ApplicationReadOptions,
    ) => Promise<string[]>
    readonly jjRefreshState: (
        options: ApplicationReadOptions,
    ) => Promise<JjRefreshState>
    readonly jjFiles: (
        target: JjDiffTarget,
        options: ApplicationReadOptions,
    ) => Promise<FileChange[]>
    readonly jjCommitDetails: (
        revision: string,
        options: ApplicationReadOptions,
    ) => Promise<JjCommitDetails>
    readonly jjOpLog: (
        limit: number | undefined,
        options: ApplicationReadOptions,
    ) => Promise<string[]>
    readonly jjDiff: (
        target: JjDiffTarget,
        options: ApplicationDiffOptions,
    ) => Promise<string>
    readonly jjBookmarks: (
        options: ApplicationBookmarkReadOptions,
    ) => Promise<Bookmark[]>
    readonly jjStreamBookmarks: (
        options: ApplicationBookmarkReadOptions,
        onBatch: (bookmarks: readonly Bookmark[]) => void | Promise<void>,
    ) => ApplicationStreamHandle<Bookmark[]>
    readonly jjLogPage: (
        options: ApplicationLogReadOptions,
    ) => Promise<LogPageResult>
    readonly jjStreamLogPage: (
        options: ApplicationLogReadOptions,
        onBatch: (commits: readonly Commit[]) => void | Promise<void>,
    ) => ApplicationStreamHandle<LogPageResult>
    readonly stackParent: (
        bookmark: string,
        options: ApplicationReadOptions,
    ) => Promise<string | undefined>
    readonly prepareStackSync: (
        stackRootName: string,
        options: ApplicationStackOptions,
    ) => Promise<StackPlan<Bookmark>>
    readonly applyStackPlan: (
        plan: StackPlan<Bookmark>,
        options: ApplicationStackOptions,
    ) => Promise<void>
    readonly ghListPullRequestsByHead: (
        heads: readonly string[],
        options: ApplicationReadOptions & { readonly includeClosed?: boolean },
    ) => Promise<Map<string, GitHubPullRequestSummary>>
    readonly ghPrCreateWeb: (
        head: string,
        options: ApplicationGitHubOperationOptions,
    ) => Promise<OperationResult>
    readonly ghBrowseCommit: (
        commit: string,
        options: ApplicationGitHubOperationOptions,
    ) => Promise<OperationResult>
    readonly ghPrViewWeb: (
        prNumber: number,
        options: ApplicationGitHubOperationOptions,
    ) => Promise<OperationResult>
    readonly dispose: () => Promise<void>
}

export class ApplicationClientClosedError extends Error {
    constructor() {
        super("The application runtime is shutting down")
        this.name = "ApplicationClientClosedError"
    }
}

function errorMessage(error: OperationFailure): string {
    if (error._tag === "ProcessTimeoutError") {
        return `Command timed out after ${error.timeoutMs}ms`
    }
    if (error._tag === "OperationInterruptedError") return "Command cancelled"
    const cause = error.cause
    return cause instanceof Error ? cause.message : String(cause)
}

function observerSink(observer: CommandObserver | undefined): {
    readonly sink: OperationSink
    readonly wasLogged: () => boolean
} {
    let logId: string | undefined
    return {
        sink: {
            start: (command, kind = "jj") => {
                logId = observer?.start(command, { kind })
            },
            output: (_stream, chunk) => {
                if (logId) observer?.append(logId, chunk)
            },
            finish: (result) => {
                if (!logId) return
                observer?.finish(logId, {
                    ...result,
                    success: result.exitCode === 0,
                    logged: true,
                })
            },
            fail: (error) => {
                if (!logId) return
                observer?.finish(logId, {
                    stdout: "",
                    stderr: errorMessage(error),
                    exitCode: -1,
                    success: false,
                    logged: true,
                })
            },
            skip: (message) => observer?.skip(message),
        },
        wasLogged: () => Boolean(logId),
    }
}

export function makeApplicationClient(
    appProcessLayer = AppProcessLive,
    hooksLayer = HooksLive,
    stackLayer: Layer.Layer<Stack, never, Jj | GitHub | StackStore> = StackLive,
    stackStoreLayer = StackStoreLive,
    interactiveProcessLayer: Layer.Layer<InteractiveProcess> = InteractiveProcessLive,
): ApplicationClient {
    const providedHooksLayer = hooksLayer.pipe(Layer.provide(appProcessLayer))
    const dependencies = Layer.merge(appProcessLayer, providedHooksLayer)
    const providedJjLayer = JjLayer.pipe(Layer.provide(dependencies))
    const providedGitLayer = GitLive.pipe(Layer.provide(appProcessLayer))
    const gitHubDependencies = Layer.merge(appProcessLayer, providedGitLayer)
    const providedGitHubLayer = GitHubLive.pipe(
        Layer.provide(gitHubDependencies),
    )
    const repositoryBootstrapDependencies = Layer.merge(
        providedJjLayer,
        providedGitLayer,
    )
    const providedRepositoryBootstrapLayer = RepositoryBootstrapLive.pipe(
        Layer.provide(repositoryBootstrapDependencies),
    )
    const stackDependencies = Layer.mergeAll(
        providedJjLayer,
        providedGitHubLayer,
        stackStoreLayer,
    )
    const providedStackLayer = stackLayer.pipe(Layer.provide(stackDependencies))
    const providedInteractiveJjLayer = InteractiveJjLive.pipe(
        Layer.provide(interactiveProcessLayer),
    )
    const runtime = ManagedRuntime.make(
        Layer.mergeAll(
            providedJjLayer,
            providedHooksLayer,
            providedGitHubLayer,
            providedRepositoryBootstrapLayer,
            providedStackLayer,
            providedInteractiveJjLayer,
        ),
    )
    const historicalFiles = makeHistoricalFileStore()
    let accepting = true
    let disposePromise: Promise<void> | undefined

    const runRead = <A, E>(
        options: ApplicationReadOptions,
        operation: (jj: JjService) => Effect.Effect<A, E>,
    ): Promise<A> => {
        if (!accepting)
            return Promise.reject(new ApplicationClientClosedError())
        return runtime.runPromise(Jj.use(operation), { signal: options.signal })
    }

    const runStream = <A, E>(
        options: ApplicationReadOptions,
        operation: (jj: JjService) => Effect.Effect<A, E>,
    ): ApplicationStreamHandle<A> => {
        const controller = new AbortController()
        const signal = options.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal
        return {
            result: runRead({ ...options, signal }, operation),
            cancel: () => controller.abort(),
        }
    }

    const runInteractive = async (
        signal: AbortSignal | undefined,
        failureCommand: string,
        operation: (
            jj: InteractiveJjService,
        ) => Effect.Effect<InteractiveJjResult, InteractiveProcessSpawnError>,
    ): Promise<ApplicationInteractiveResult> => {
        if (!accepting) throw new ApplicationClientClosedError()
        const result = await runtime.runPromise(InteractiveJj.use(operation), {
            signal,
        })
        return result.exitCode === 0
            ? { success: true }
            : {
                  success: false,
                  error: `${failureCommand} exited with code ${result.exitCode}`,
              }
    }

    const runHookRead = <A, E>(
        options: ApplicationReadOptions,
        operation: (hooks: HooksService) => Effect.Effect<A, E>,
    ): Promise<A> => {
        if (!accepting)
            return Promise.reject(new ApplicationClientClosedError())
        return runtime.runPromise(Hooks.use(operation), {
            signal: options.signal,
        })
    }

    const runRepositoryBootstrap = <A>(
        signal: AbortSignal | undefined,
        operation: (repository: RepositoryBootstrapService) => Effect.Effect<A>,
    ): Promise<A> => {
        if (!accepting)
            return Promise.reject(new ApplicationClientClosedError())
        return runtime.runPromise(RepositoryBootstrap.use(operation), {
            signal,
        })
    }

    const runStack = <A, E>(
        options: ApplicationStackOptions,
        operation: (
            stack: StackService,
            sink: OperationSink,
        ) => Effect.Effect<A, E>,
    ): Promise<A> => {
        if (!accepting)
            return Promise.reject(new ApplicationClientClosedError())
        const { observer, signal } = options
        const { sink } = observerSink(observer)
        return runtime.runPromise(
            Stack.use((stack) => operation(stack, sink)),
            {
                signal,
            },
        )
    }

    const runGitHubRead = <A, E>(
        options: ApplicationReadOptions,
        operation: (gitHub: GitHubService) => Effect.Effect<A, E>,
    ): Promise<A> => {
        if (!accepting)
            return Promise.reject(new ApplicationClientClosedError())
        return runtime.runPromise(GitHub.use(operation), {
            signal: options.signal,
        })
    }

    const runGitHubOperation = async <E>(
        options: ApplicationGitHubOperationOptions,
        operation: (
            gitHub: GitHubService,
            sink: OperationSink,
        ) => Effect.Effect<GitHubOperationResult, E>,
    ): Promise<OperationResult> => {
        if (!accepting) throw new ApplicationClientClosedError()
        const { observer, signal, ...runOptions } = options
        const { sink, wasLogged } = observerSink(observer)
        const startedAt = performance.now()
        const result = await runtime.runPromise(
            GitHub.use((gitHub) => operation(gitHub, sink)),
            { signal },
        )
        const success = result.exitCode === 0
        diagnosticsLog(success ? "info" : "error", "gh command finished", {
            command: result.command,
            cwd: runOptions.cwd,
            durationMs: Math.round(performance.now() - startedAt),
            exitCode: result.exitCode,
            ...(result.stderr ? { stderr: result.stderr.slice(0, 4000) } : {}),
        })
        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            success,
            logged: wasLogged(),
            command: result.command,
        }
    }

    const runOperation = async (
        options: ApplicationOperationOptions,
        operation: (
            jj: JjService,
            sink: OperationSink,
        ) => Effect.Effect<JjOperationResult, JjCommandError | ProcessError>,
    ): Promise<OperationResult> => {
        if (!accepting) throw new ApplicationClientClosedError()
        const { observer, signal, ...runOptions } = options
        const { sink, wasLogged } = observerSink(observer)
        const startedAt = performance.now()
        const effect = Jj.use((jj) =>
            operation(jj, sink).pipe(
                Effect.catchTag("JjCommandError", (error) =>
                    Effect.succeed({
                        ...error.result,
                        command: error.command,
                    }),
                ),
            ),
        )
        const result = await runtime.runPromise(effect, { signal })
        const success = result.exitCode === 0
        diagnosticsLog(success ? "info" : "error", "jj command finished", {
            command: result.command,
            cwd: runOptions.cwd,
            durationMs: Math.round(performance.now() - startedAt),
            exitCode: result.exitCode,
            ...(result.stderr ? { stderr: result.stderr.slice(0, 4000) } : {}),
        })
        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            success,
            logged: wasLogged(),
            command: result.command,
        }
    }

    return {
        repositoryStatus: (path, options) =>
            runRepositoryBootstrap(options?.signal, (repository) =>
                repository.inspect(path),
            ),
        initializeRepository: (path, options) =>
            runRepositoryBootstrap(options?.signal, (repository) =>
                repository.initialize(path, { colocate: options?.colocate }),
            ),
        jjGitFetch: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.gitFetch({ ...options, sink }),
            ),
        jjGitPush: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.gitPush({ ...options, sink }),
            ),
        jjUndo: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.undo({ ...options, sink }),
            ),
        jjRedo: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.redo({ ...options, sink }),
            ),
        jjOpRestore: (operationId, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.opRestore(operationId, { ...options, sink }),
            ),
        jjWorkspaceUpdateStale: ({ observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.workspaceUpdateStale({ ...options, sink }),
            ),
        jjEdit: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.edit(revision, { ...options, sink }),
            ),
        jjDescribe: (revision, message, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.describe(revision, message, { ...options, sink }),
            ),
        jjSquash: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.squash(revision, { ...options, sink }),
            ),
        jjSplitInteractive: (revision, { signal, ...options }) =>
            runInteractive(signal, "jj split", (jj) =>
                jj.split(revision, options),
            ),
        jjResolveInteractive: ({ signal, ...options }) =>
            runInteractive(signal, "jj resolve", (jj) => jj.resolve(options)),
        jjSquashInteractive: (revision, { signal, ...options }) =>
            runInteractive(signal, "jj squash -i", (jj) =>
                jj.squash(revision, options),
            ),
        jjRebase: (revision, destination, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.rebase(revision, destination, { ...options, sink }),
            ),
        jjBookmarkCreate: (name, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkCreate(name, { ...options, sink }),
            ),
        jjBookmarkSet: (name, revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkSet(name, revision, { ...options, sink }),
            ),
        jjBookmarkDelete: (name, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkDelete(name, { ...options, sink }),
            ),
        jjBookmarkRename: (
            oldName,
            newName,
            { observer, signal, ...options },
        ) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkRename(oldName, newName, { ...options, sink }),
            ),
        jjBookmarkForget: (name, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.bookmarkForget(name, { ...options, sink }),
            ),
        jjNew: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.new(revision, { ...options, sink }),
            ),
        jjNewBefore: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.new(revision, { ...options, position: "before", sink }),
            ),
        jjNewAfter: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.new(revision, { ...options, position: "after", sink }),
            ),
        hasPreHooks: (operationId, options) =>
            runHookRead(options, (hooks) =>
                hooks.hasPreHooks(operationId, options.cwd),
            ),
        jjDuplicate: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.duplicate(revision, { ...options, sink }),
            ),
        jjAbandon: (revision, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.abandon(revision, { ...options, sink }),
            ),
        jjRestore: (paths, { observer, signal, ...options }) =>
            runOperation({ ...options, observer, signal }, (jj, sink) =>
                jj.restore(paths, { ...options, sink }),
            ),
        jjMaterializeFiles: (revision, paths, options) => {
            if (!accepting) {
                return Promise.reject(new ApplicationClientClosedError())
            }
            return historicalFiles.materialize(
                revision,
                paths,
                (selectedRevision, path, outputPath) =>
                    runRead(options, (jj) =>
                        jj.materializeFile(selectedRevision, path, outputPath, {
                            cwd: options.cwd,
                            timeoutMs: options.timeoutMs,
                        }),
                    ),
            )
        },
        jjRepositoryRoot: (options) =>
            runRead(options, (jj) => jj.repositoryRoot(options)),
        jjRevisionSummaries: (revset, options) =>
            runRead(options, (jj) => jj.revisionSummaries(revset, options)),
        jjFileContent: (revision, path, options) =>
            runRead(options, (jj) => jj.fileContent(revision, path, options)),
        jjIsInTrunk: (revision, options) =>
            runRead(options, (jj) =>
                jj.isInTrunk(revision, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjShowDescription: (revision, options) =>
            runRead(options, (jj) =>
                jj.showDescription(revision, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjNearestAncestorBookmarkNames: (revision, options) =>
            runRead(options, (jj) =>
                jj.nearestAncestorBookmarkNames(revision, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjRefreshState: (options) =>
            runRead(options, (jj) =>
                jj.refreshState({
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjFiles: (target, options) =>
            runRead(options, (jj) =>
                jj.files(target, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjCommitDetails: (revision, options) =>
            runRead(options, (jj) =>
                jj.commitDetails(revision, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjOpLog: (limit, options) =>
            runRead(options, (jj) =>
                jj.opLog(limit, {
                    cwd: options.cwd,
                    timeoutMs: options.timeoutMs,
                }),
            ),
        jjDiff: (target, options) =>
            runRead(options, (jj) => jj.diff(target, options)),
        jjBookmarks: (options) =>
            runRead(options, (jj) => jj.bookmarks(options)),
        jjStreamBookmarks: (options, onBatch) =>
            runStream(options, (jj) => jj.streamBookmarks(options, onBatch)),
        jjLogPage: (options) => runRead(options, (jj) => jj.logPage(options)),
        jjStreamLogPage: (options, onBatch) =>
            runStream(options, (jj) => jj.streamLogPage(options, onBatch)),
        stackParent: (bookmark, options) =>
            runStack(options, (stack) =>
                stack.persistedParent(bookmark, options.cwd),
            ),
        prepareStackSync: (stackRootName, options) =>
            runStack(options, (stack, sink) =>
                stack.prepareSyncPlan({
                    cwd: options.cwd,
                    stackRootName,
                    sink,
                }),
            ),
        applyStackPlan: (plan, options) =>
            runStack(options, (stack, sink) =>
                stack.applyStackPlan(plan, { cwd: options.cwd, sink }),
            ),
        ghListPullRequestsByHead: (heads, options) =>
            runGitHubRead(options, (gitHub) =>
                gitHub.listPullRequestsByHead(heads, options),
            ),
        ghPrCreateWeb: (head, { observer, signal, ...options }) =>
            runGitHubOperation(
                { ...options, observer, signal },
                (gitHub, sink) =>
                    gitHub.prCreateWeb(head, { ...options, sink }),
            ),
        ghBrowseCommit: (commit, { observer, signal, ...options }) =>
            runGitHubOperation(
                { ...options, observer, signal },
                (gitHub, sink) =>
                    gitHub.browseCommit(commit, { ...options, sink }),
            ),
        ghPrViewWeb: (prNumber, { observer, signal, ...options }) =>
            runGitHubOperation(
                { ...options, observer, signal },
                (gitHub, sink) =>
                    gitHub.prViewWeb(prNumber, { ...options, sink }),
            ),
        dispose: () => {
            accepting = false
            if (!disposePromise) {
                disposePromise = runtime
                    .dispose()
                    .finally(() => historicalFiles.dispose())
            }
            return disposePromise
        },
    }
}
