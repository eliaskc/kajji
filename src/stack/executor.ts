import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import type { Bookmark } from "../commander/bookmarks"
import { GitHub } from "../commander/github-service"
import { Jj } from "../commander/jj"
import type { OperationSink } from "../process/operation-sink"
import { buildBookmarkStackModel } from "./discovery"
import type {
    BookmarkStackModel,
    StackPlan,
    StackPullRequestInput,
} from "./model"
import { buildSyncPlanSync } from "./planner"
import type { PersistedStackEntry } from "./state"
import { type StackJournal, type StackJournalEntry, StackStore } from "./store"

export interface PrepareStackPlanOptions {
    readonly cwd: string
    readonly stackRootName: string
    readonly sink?: OperationSink
}

export interface ApplyStackPlanOptions {
    readonly cwd: string
    readonly sink?: OperationSink
}

type FreshBookmark = Bookmark

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
    )
        return error.message
    return String(error)
}

export class StackPrepareError extends Schema.TaggedErrorClass<StackPrepareError>()(
    "StackPrepareError",
    {
        message: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class StackPlanStaleError extends Schema.TaggedErrorClass<StackPlanStaleError>()(
    "StackPlanStaleError",
    {
        stackRootName: Schema.String,
    },
) {
    override get message() {
        return `Stack ${this.stackRootName} changed after preview; prepare it again`
    }
}

export class StackApplyError extends Schema.TaggedErrorClass<StackApplyError>()(
    "StackApplyError",
    {
        message: Schema.String,
        cause: Schema.Defect(),
        completedEntries: Schema.Array(
            Schema.Record(Schema.String, Schema.Unknown),
        ),
    },
) {}

export interface StackService {
    readonly persistedParent: (
        bookmark: string,
        cwd: string,
    ) => Effect.Effect<string | undefined, StackPrepareError>
    readonly prepareSyncPlan: (
        options: PrepareStackPlanOptions,
    ) => Effect.Effect<StackPlan<FreshBookmark>, StackPrepareError>
    readonly applyStackPlan: (
        plan: StackPlan<FreshBookmark>,
        options: ApplyStackPlanOptions,
    ) => Effect.Effect<void, StackPlanStaleError | StackApplyError>
}

export class Stack extends Context.Service<Stack, StackService>()(
    "kajji/Stack",
) {}

interface FreshStackState {
    readonly stackModel: BookmarkStackModel<FreshBookmark>
    readonly pullRequestsByHead: ReadonlyMap<string, StackPullRequestInput>
    readonly remoteBookmarksByName: ReadonlyMap<string, FreshBookmark>
}

export const StackLive = Layer.effect(
    Stack,
    Effect.gen(function* () {
        const jj = yield* Jj
        const gitHub = yield* GitHub
        const store = yield* StackStore
        const applyLocks = new Map<string, Semaphore.Semaphore>()

        const readStackState = Effect.fn("Stack.readState")(function* (
            options: ApplyStackPlanOptions,
        ) {
            const [{ commits }, allBookmarks] = yield* Effect.all(
                [
                    jj.logPage({ cwd: options.cwd, limit: 1000 }),
                    jj.bookmarks({ cwd: options.cwd, allRemotes: true }),
                ],
                { concurrency: "unbounded" },
            )
            const localBookmarks = allBookmarks.filter(
                (bookmark) => bookmark.isLocal,
            )
            const remoteBookmarks = allBookmarks.filter(
                (bookmark) => !bookmark.isLocal,
            )
            const commitInputs = commits.map((commit) => ({
                commitId: commit.commitId,
                parentCommitIds: commit.parentCommitIds ?? [],
                immutable: commit.immutable,
            }))
            const stackModel = buildBookmarkStackModel({
                commits: commitInputs,
                bookmarks: localBookmarks,
            })
            return {
                commits: commitInputs,
                localBookmarks,
                remoteBookmarks,
                stackModel,
            }
        })

        const loadFreshState = Effect.fn("Stack.loadFreshState")(function* (
            options: PrepareStackPlanOptions & {
                readonly includeClosedPulls: boolean
                readonly fetch: boolean
            },
        ) {
            const preFetchState =
                options.fetch && options.includeClosedPulls
                    ? yield* readStackState(options)
                    : undefined
            if (options.fetch) {
                yield* jj.gitFetch({ cwd: options.cwd, sink: options.sink })
            }

            const freshState = yield* readStackState(options)
            const persistedState = yield* store.readState(options.cwd)
            const localBookmarks = restorePersistedLocalBookmarks(
                reconcileFetchedLocalBookmarks(
                    freshState.localBookmarks,
                    preFetchState?.stackModel,
                    options.stackRootName,
                ),
                persistedState.entries,
            )
            const stackModel = buildBookmarkStackModel({
                commits: freshState.commits,
                bookmarks: localBookmarks,
            })
            const heads = uniqueStrings([
                ...stackModel.rows.map((row) => row.bookmark.name),
                ...persistedState.entries.map((entry) => entry.bookmark),
            ])
            const pullRequestsByHead = yield* gitHub.listPullRequestsByHead(
                heads,
                {
                    cwd: options.cwd,
                    includeClosed: options.includeClosedPulls,
                },
            )
            const remoteBookmarksByName = new Map(
                freshState.remoteBookmarks.map((bookmark) => [
                    bookmark.name,
                    bookmark,
                ]),
            )
            return {
                stackModel,
                pullRequestsByHead,
                remoteBookmarksByName,
            } satisfies FreshStackState
        })

        const detectLandedParentRanges = Effect.fn(
            "Stack.detectLandedParentRanges",
        )(function* (
            stackModel: BookmarkStackModel<FreshBookmark>,
            pullRequestsByHead: ReadonlyMap<string, StackPullRequestInput>,
            options: ApplyStackPlanOptions,
        ) {
            const persisted = yield* store.readState(options.cwd)
            const persistedByBookmark = new Map(
                persisted.entries.map((entry) => [entry.bookmark, entry]),
            )
            const ranges = new Map<string, string>()

            for (const row of stackModel.rows) {
                const bookmark = row.bookmark
                const entry = persistedByBookmark.get(bookmark.name)
                if (!entry) continue
                const previousParent = persistedByBookmark.get(entry.parent)
                if (!previousParent) continue
                const parentPull = pullRequestsByHead.get(
                    previousParent.bookmark,
                )
                if (
                    parentPull?.merged !== true &&
                    parentPull?.state !== "MERGED"
                )
                    continue
                const currentBase =
                    parentPull.baseRefName ??
                    stackModel.parentByName.get(bookmark.name)
                const oldBase =
                    previousParent.parentChangeId ?? previousParent.parent
                const oldHead =
                    previousParent.headChangeId ?? previousParent.bookmark
                if (!currentBase) continue
                const range = `(${oldBase}..${oldHead}) & ancestors(${bookmark.changeId ?? bookmark.name}) ~ ancestors(${currentBase})`
                if (yield* jj.revsetHasMatches(range, { cwd: options.cwd })) {
                    ranges.set(bookmark.name, range)
                }
            }
            return ranges
        })

        const buildPlan = Effect.fn("Stack.buildSyncPlan")(function* (
            options: PrepareStackPlanOptions,
            fetch: boolean,
        ) {
            const state = yield* loadFreshState({
                ...options,
                includeClosedPulls: true,
                fetch,
            })
            const landedRangesByBookmark = yield* detectLandedParentRanges(
                state.stackModel,
                state.pullRequestsByHead,
                options,
            )
            return buildSyncPlanSync({
                stackRootName: options.stackRootName,
                stackModel: state.stackModel,
                pullRequestsByHead: state.pullRequestsByHead,
                remoteBookmarksByName: state.remoteBookmarksByName,
                landedRangesByBookmark,
            })
        })

        const record = Effect.fn("Stack.recordJournalEntry")(function* (
            options: ApplyStackPlanOptions,
            journal: StackJournal,
            entry: StackJournalEntry,
        ) {
            const nextJournal = {
                ...journal,
                entries: [...journal.entries, entry],
            }
            yield* store.writeJournal(options.cwd, nextJournal)
            journal.entries.push(entry)
        })

        const applyEffects = Effect.fn("Stack.applyEffects")(function* (
            plan: StackPlan<FreshBookmark>,
            journal: StackJournal,
            options: ApplyStackPlanOptions,
        ) {
            const operationOptions = { cwd: options.cwd, sink: options.sink }
            const prByBookmark = new Map(
                plan.rows
                    .filter((row) => row.prNumber)
                    .map((row) => [row.row.bookmark.name, row.prNumber ?? 0]),
            )

            for (const effect of plan.effects) {
                if (
                    effect.type !== "abandon" &&
                    effect.type !== "abandon-landed-range"
                )
                    continue
                yield* jj.abandon(
                    effect.range ?? effect.revision ?? effect.bookmark,
                    operationOptions,
                )
                yield* record(options, journal, {
                    type:
                        effect.type === "abandon-landed-range"
                            ? "LandedRangeAbandoned"
                            : "BookmarkAbandoned",
                    bookmark: effect.bookmark,
                    prNumber: effect.prNumber,
                })
            }

            const pushedBookmarks = new Set<string>()
            for (const row of plan.rows) {
                if (!row.effects.some((effect) => effect.type === "create-pr"))
                    continue
                for (const effect of row.effects) {
                    if (effect.type !== "push") continue
                    yield* jj.gitPush({
                        ...operationOptions,
                        bookmarks: [effect.bookmark],
                    })
                    pushedBookmarks.add(effect.bookmark)
                    yield* record(options, journal, {
                        type: "BookmarkPushed",
                        bookmark: effect.bookmark,
                    })
                }
            }

            for (const row of plan.rows) {
                const bookmark = row.row.bookmark
                const createEffect = row.effects.find(
                    (effect) => effect.type === "create-pr",
                )
                if (!createEffect) continue
                yield* gitHub.prCreate(
                    {
                        head: bookmark.name,
                        base: row.desiredBase ?? plan.stackRootName,
                    },
                    operationOptions,
                )
                const fresh = yield* gitHub.listPullRequestsByHead(
                    [bookmark.name],
                    { cwd: options.cwd },
                )
                const pull = fresh.get(bookmark.name)
                if (pull) {
                    prByBookmark.set(bookmark.name, pull.number)
                    yield* record(options, journal, {
                        type: "PrCreated",
                        prNumber: pull.number,
                        head: bookmark.name,
                    })
                }
            }

            for (const effect of plan.effects) {
                if (effect.type === "rebase" && effect.to) {
                    yield* jj.rebase(effect.bookmark, effect.to, {
                        ...operationOptions,
                        mode: "descendants",
                        skipEmptied: true,
                    })
                    yield* record(options, journal, {
                        type: "BookmarkRebased",
                        bookmark: effect.bookmark,
                        from: effect.from,
                        to: effect.to,
                    })
                }
                if (effect.type === "push") {
                    if (pushedBookmarks.has(effect.bookmark)) continue
                    yield* jj.gitPush({
                        ...operationOptions,
                        bookmarks: [effect.bookmark],
                    })
                    yield* record(options, journal, {
                        type: "BookmarkPushed",
                        bookmark: effect.bookmark,
                    })
                }
                if (
                    effect.type === "update-pr" &&
                    effect.prNumber &&
                    effect.to
                ) {
                    yield* gitHub.prEditBase(
                        effect.prNumber,
                        effect.to,
                        operationOptions,
                    )
                    yield* record(options, journal, {
                        type: "PrBaseChanged",
                        prNumber: effect.prNumber,
                        from: effect.from,
                        to: effect.to,
                    })
                }
                if (effect.type === "close-pr" && effect.prNumber) {
                    yield* gitHub.prClose(effect.prNumber, operationOptions)
                    yield* record(options, journal, {
                        type: "PrClosed",
                        prNumber: effect.prNumber,
                    })
                }
            }

            const stackPrNumbers = plan.rows
                .map(
                    (row) =>
                        prByBookmark.get(row.row.bookmark.name) ?? row.prNumber,
                )
                .filter(
                    (number): number is number => typeof number === "number",
                )
            for (const row of plan.rows) {
                const prNumber =
                    prByBookmark.get(row.row.bookmark.name) ?? row.prNumber
                if (!prNumber) continue
                yield* gitHub.upsertStackComment(
                    prNumber,
                    renderStackComment(prNumber, stackPrNumbers),
                    operationOptions,
                )
                yield* record(options, journal, {
                    type: "StackCommentUpdated",
                    prNumber,
                })
            }
            return prByBookmark
        })

        const persistStackStateFromPlan = Effect.fn("Stack.persistState")(
            function* (
                plan: StackPlan<FreshBookmark>,
                prByBookmark: ReadonlyMap<string, number>,
                options: ApplyStackPlanOptions,
            ) {
                const previous = yield* store.readState(options.cwd)
                const nextByBookmark = new Map(
                    previous.entries.map((entry) => [entry.bookmark, entry]),
                )
                const syncedAt = new Date().toISOString()

                for (const row of plan.rows) {
                    const bookmark = row.row.bookmark
                    const parent = row.desiredBase
                    if (!parent || parent === bookmark.name) continue
                    const isTrunk =
                        row.row.depth === 0 &&
                        plan.stackRootName !== bookmark.name
                    if (isTrunk) continue
                    const prNumber =
                        prByBookmark.get(bookmark.name) ?? row.prNumber
                    if (
                        !prNumber &&
                        row.effects.some(
                            (effect) => effect.type === "create-pr",
                        )
                    )
                        continue
                    const parentRow = plan.rows.find(
                        (candidate) => candidate.row.bookmark.name === parent,
                    )
                    const entry: PersistedStackEntry = {
                        bookmark: bookmark.name,
                        parent,
                        ...(prNumber ? { prNumber } : {}),
                        ...(bookmark.changeId
                            ? { headChangeId: bookmark.changeId }
                            : {}),
                        headCommitId: bookmark.commitId,
                        ...(parentRow?.row.bookmark.changeId
                            ? {
                                  parentChangeId:
                                      parentRow.row.bookmark.changeId,
                              }
                            : {}),
                        ...(parentRow?.row.bookmark.commitId
                            ? {
                                  parentCommitId:
                                      parentRow.row.bookmark.commitId,
                              }
                            : {}),
                        baseRefName: parent,
                        syncedAt,
                    }
                    nextByBookmark.set(bookmark.name, entry)
                }

                yield* store.writeState(options.cwd, {
                    version: 1,
                    entries: [...nextByBookmark.values()],
                })
            },
        )

        const apply = Effect.fn("Stack.applyStackPlan")(function* (
            plan: StackPlan<FreshBookmark>,
            options: ApplyStackPlanOptions,
        ) {
            if (plan.effects.length === 0) return

            const freshPlan = yield* buildPlan(
                {
                    cwd: options.cwd,
                    stackRootName: plan.stackRootName,
                    sink: options.sink,
                },
                false,
            ).pipe(
                Effect.catch((cause) =>
                    Effect.fail(
                        new StackApplyError({
                            message: errorMessage(cause),
                            cause,
                            completedEntries: [],
                        }),
                    ),
                ),
            )
            if (planRevision(freshPlan) !== planRevision(plan)) {
                return yield* new StackPlanStaleError({
                    stackRootName: plan.stackRootName,
                })
            }

            const beforeOperationId = yield* jj
                .operationId({ cwd: options.cwd })
                .pipe(
                    Effect.catch((cause) =>
                        Effect.fail(
                            new StackApplyError({
                                message: errorMessage(cause),
                                cause,
                                completedEntries: [],
                            }),
                        ),
                    ),
                )
            const journal = makeStackJournal(plan, beforeOperationId)
            const mutation = Effect.gen(function* () {
                yield* store.writeJournal(options.cwd, journal)
                const prByBookmark = yield* applyEffects(plan, journal, options)
                yield* persistStackStateFromPlan(plan, prByBookmark, options)
                journal.afterOperationId = yield* jj.operationId({
                    cwd: options.cwd,
                })
                yield* store.writeJournal(options.cwd, journal)
            })
            return yield* mutation.pipe(
                Effect.catch((cause) =>
                    Effect.fail(
                        new StackApplyError({
                            message: errorMessage(cause),
                            cause,
                            completedEntries: [...journal.entries],
                        }),
                    ),
                ),
            )
        })

        return Stack.of({
            persistedParent: (bookmark, cwd) =>
                store.readState(cwd).pipe(
                    Effect.map(
                        (state) =>
                            state.entries.find(
                                (entry) => entry.bookmark === bookmark,
                            )?.parent,
                    ),
                    Effect.catch((cause) =>
                        Effect.fail(
                            new StackPrepareError({
                                message: errorMessage(cause),
                                cause,
                            }),
                        ),
                    ),
                ),
            prepareSyncPlan: (options) =>
                buildPlan(options, true).pipe(
                    Effect.catch((cause) =>
                        Effect.fail(
                            new StackPrepareError({
                                message: errorMessage(cause),
                                cause,
                            }),
                        ),
                    ),
                ),
            applyStackPlan: (plan, options) => {
                let lock = applyLocks.get(options.cwd)
                if (!lock) {
                    lock = Semaphore.makeUnsafe(1)
                    applyLocks.set(options.cwd, lock)
                }
                return lock.withPermit(apply(plan, options))
            },
        })
    }),
) satisfies Layer.Layer<Stack, never, Jj | GitHub | StackStore>

function restorePersistedLocalBookmarks(
    localBookmarks: readonly FreshBookmark[],
    entries: readonly PersistedStackEntry[],
): readonly FreshBookmark[] {
    const localNames = new Set(localBookmarks.map((bookmark) => bookmark.name))
    const restored = entries.flatMap((entry) => {
        if (localNames.has(entry.bookmark)) return []
        const headCommitId = entry.headCommitId
        const headChangeId = entry.headChangeId
        if (!headCommitId || !headChangeId) return []
        return [
            {
                name: entry.bookmark,
                nameDisplay: entry.bookmark,
                commitId: headCommitId,
                commitIdDisplay: headCommitId.slice(0, 8),
                changeId: headChangeId,
                changeIdDisplay: headChangeId,
                description: "",
                descriptionDisplay: "",
                isLocal: true,
                remote: undefined,
            } satisfies FreshBookmark,
        ]
    })
    return restored.length > 0
        ? [...localBookmarks, ...restored]
        : localBookmarks
}

function reconcileFetchedLocalBookmarks(
    localBookmarks: readonly FreshBookmark[],
    preFetchStackModel: BookmarkStackModel<FreshBookmark> | undefined,
    stackRootName: string,
): readonly FreshBookmark[] {
    if (!preFetchStackModel) return localBookmarks
    if (localBookmarks.some((bookmark) => bookmark.name === stackRootName))
        return localBookmarks
    const preFetchRows = preFetchStackModel.rows.filter((row) =>
        row.stackKeys.includes(stackRootName),
    )
    if (preFetchRows.length === 0) return localBookmarks
    const localNames = new Set(localBookmarks.map((bookmark) => bookmark.name))
    const restoredBookmarks = preFetchRows
        .map((row) => row.bookmark)
        .filter((bookmark) => !localNames.has(bookmark.name))
    return restoredBookmarks.length === 0
        ? localBookmarks
        : [...localBookmarks, ...restoredBookmarks]
}

function uniqueStrings(values: readonly string[]): readonly string[] {
    return [...new Set(values)]
}

function renderStackComment(
    currentPr: number,
    stackPrNumbers: readonly number[],
) {
    return [
        `<!-- kajji-stack pr=${currentPr} -->`,
        "",
        "### Stack",
        "",
        ...stackPrNumbers.map(
            (number, index) =>
                `${index + 1}. #${number}${number === currentPr ? " 👈" : ""}`,
        ),
        "",
        "This stack is managed by [kajji](https://github.com/eliaskc/kajji).",
    ].join("\n")
}

function makeStackJournal(
    plan: StackPlan<FreshBookmark>,
    beforeOperationId: string,
): StackJournal {
    return {
        version: 1,
        id: crypto.randomUUID(),
        kind: plan.kind,
        stackRootName: plan.stackRootName,
        beforeOperationId,
        createdAt: new Date().toISOString(),
        entries: [],
    }
}

function planRevision(plan: StackPlan<FreshBookmark>): string {
    return JSON.stringify({
        stackRootName: plan.stackRootName,
        rows: plan.rows.map((row) => ({
            bookmark: row.row.bookmark.name,
            commitId: row.row.bookmark.commitId,
            changeId: row.row.bookmark.changeId,
            prNumber: row.prNumber,
            desiredBase: row.desiredBase,
            effects: row.effects,
        })),
        effects: plan.effects,
    })
}
