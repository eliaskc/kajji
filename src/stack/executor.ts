import { Effect } from "effect"
import { type Bookmark, fetchBookmarks } from "../commander/bookmarks"
import {
    ghListPullRequestsByHead,
    ghPrClose,
    ghPrCreate,
    ghPrEditBase,
    ghUpsertStackComment,
} from "../commander/github"
import { fetchLogPage } from "../commander/log"
import type { CommandObserver } from "../commander/observer"
import {
    fetchOpLogId,
    jjAbandon,
    jjGitFetch,
    jjGitPushBookmark,
    jjRebase,
    jjRevsetHasMatches,
} from "../commander/operations"
import { getRepoPath } from "../repo"
import { buildBookmarkStackModel } from "./discovery"
import type {
    BookmarkStackModel,
    StackPlan,
    StackPullRequestInput,
} from "./model"
import { buildSyncPlanSync } from "./planner"
import {
    type PersistedStackEntry,
    readPersistedStackState,
    writePersistedStackState,
} from "./state"

export interface PrepareStackPlanOptions {
    readonly stackRootName: string
    readonly observer?: CommandObserver
}

export interface ApplyStackPlanOptions {
    readonly observer?: CommandObserver
}

type FreshBookmark = Bookmark

export const prepareSyncPlan = Effect.fn("Stack.prepareSyncPlan")(
    (options: PrepareStackPlanOptions) =>
        Effect.promise(async () => {
            const state = await loadFreshState({
                stackRootName: options.stackRootName,
                observer: options.observer,
                includeClosedPulls: true,
            })
            const landedRangesByBookmark = await detectLandedParentRanges(
                state.stackModel,
                state.pullRequestsByHead,
            )
            return buildSyncPlanSync({
                stackRootName: options.stackRootName,
                stackModel: state.stackModel,
                pullRequestsByHead: state.pullRequestsByHead,
                remoteBookmarksByName: state.remoteBookmarksByName,
                landedRangesByBookmark,
            })
        }),
)

export const applyStackPlan = Effect.fn("Stack.applyPlan")(
    (plan: StackPlan<FreshBookmark>, options: ApplyStackPlanOptions = {}) =>
        Effect.promise(async () => {
            if (plan.effects.length === 0) return
            const beforeOp = await fetchOpLogId()
            const journal = stackJournal(plan, beforeOp)
            const prByBookmark = await applySyncPlan(plan, journal, options)
            await persistStackStateFromPlan(plan, prByBookmark)
            journal.afterOperationId = await fetchOpLogId()
            await writeJournal(journal)
        }),
)

async function loadFreshState(options: {
    readonly stackRootName: string
    readonly observer?: CommandObserver
    readonly includeClosedPulls: boolean
}) {
    const preFetchState = options.includeClosedPulls
        ? await readStackState()
        : undefined
    const fetchResult = await jjGitFetch({ observer: options.observer })
    if (!fetchResult.success)
        throw new Error(fetchResult.stderr || fetchResult.stdout)

    const freshState = await readStackState()
    const persistedState = await readPersistedStackState()
    const localBookmarks = restorePersistedLocalBookmarks(
        reconcileFetchedLocalBookmarks(
            freshState.localBookmarks,
            preFetchState?.stackModel,
            options.stackRootName,
        ),
        persistedState.entries,
    )
    const remoteBookmarks = freshState.remoteBookmarks
    const stackModel = Effect.runSync(
        buildBookmarkStackModel({
            commits: freshState.commits,
            bookmarks: localBookmarks,
        }),
    )
    const heads = uniqueStrings([
        ...stackModel.rows.map((row) => row.bookmark.name),
        ...persistedState.entries.map((entry) => entry.bookmark),
    ])
    const pullRequestsByHead = new Map<string, StackPullRequestInput>(
        [
            ...(await ghListPullRequestsByHead(heads, {
                includeClosed: options.includeClosedPulls,
            })),
        ].map(([head, pull]) => [head, pull]),
    )
    const remoteBookmarksByName = new Map(
        remoteBookmarks.map((bookmark) => [bookmark.name, bookmark]),
    )
    return { stackModel, pullRequestsByHead, remoteBookmarksByName }
}

async function readStackState() {
    const [{ commits }, allBookmarks] = await Promise.all([
        fetchLogPage({ limit: 1000 }),
        fetchBookmarks({ allRemotes: true }),
    ])
    const localBookmarks = allBookmarks.filter((bookmark) => bookmark.isLocal)
    const remoteBookmarks = allBookmarks.filter((bookmark) => !bookmark.isLocal)
    const commitInputs = commits.map((commit) => ({
        commitId: commit.commitId,
        parentCommitIds: commit.parentCommitIds ?? [],
        immutable: commit.immutable,
    }))
    const stackModel = Effect.runSync(
        buildBookmarkStackModel({
            commits: commitInputs,
            bookmarks: localBookmarks,
        }),
    )
    return {
        commits: commitInputs,
        localBookmarks,
        remoteBookmarks,
        stackModel,
    }
}

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
    if (localBookmarks.some((bookmark) => bookmark.name === stackRootName)) {
        return localBookmarks
    }
    const preFetchRows = preFetchStackModel.rows.filter((row) =>
        row.stackKeys.includes(stackRootName),
    )
    if (preFetchRows.length === 0) return localBookmarks
    const localNames = new Set(localBookmarks.map((bookmark) => bookmark.name))
    const restoredBookmarks = preFetchRows
        .map((row) => row.bookmark)
        .filter((bookmark) => !localNames.has(bookmark.name))
    if (restoredBookmarks.length === 0) return localBookmarks
    return [...localBookmarks, ...restoredBookmarks]
}

async function detectLandedParentRanges(
    stackModel: BookmarkStackModel<FreshBookmark>,
    pullRequestsByHead: ReadonlyMap<string, StackPullRequestInput>,
): Promise<ReadonlyMap<string, string>> {
    const persisted = await readPersistedStackState()
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
        const parentPull = pullRequestsByHead.get(previousParent.bookmark)
        if (parentPull?.merged !== true && parentPull?.state !== "MERGED") {
            continue
        }
        const currentBase =
            parentPull.baseRefName ?? stackModel.parentByName.get(bookmark.name)
        const oldBase = previousParent.parentChangeId ?? previousParent.parent
        const oldHead = previousParent.headChangeId ?? previousParent.bookmark
        if (!currentBase) continue
        const range = `(${oldBase}..${oldHead}) & ancestors(${bookmark.changeId ?? bookmark.name}) ~ ancestors(${currentBase})`
        if (await jjRevsetHasMatches(range)) {
            ranges.set(bookmark.name, range)
        }
    }

    return ranges
}

async function applySyncPlan(
    plan: StackPlan<FreshBookmark>,
    journal: StackJournalFile,
    options: ApplyStackPlanOptions,
) {
    const prByBookmark = new Map(
        plan.rows
            .filter((row) => row.prNumber)
            .map((row) => [row.row.bookmark.name, row.prNumber ?? 0]),
    )

    for (const effect of plan.effects) {
        if (effect.type !== "abandon" && effect.type !== "abandon-landed-range")
            continue
        const result = await jjAbandon(
            effect.range ?? effect.revision ?? effect.bookmark,
            {
                observer: options.observer,
            },
        )
        if (!result.success) throw new Error(result.stderr || result.stdout)
        journal.entries.push({
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
        if (!row.effects.some((effect) => effect.type === "create-pr")) continue
        for (const effect of row.effects) {
            if (effect.type !== "push") continue
            const result = await jjGitPushBookmark(effect.bookmark, options)
            if (!result.success) throw new Error(result.stderr || result.stdout)
            pushedBookmarks.add(effect.bookmark)
            journal.entries.push({
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
        const result = await ghPrCreate(
            {
                head: bookmark.name,
                base: row.desiredBase ?? plan.stackRootName,
            },
            options,
        )
        if (!result.success) throw new Error(result.stderr || result.stdout)
        const fresh = await ghListPullRequestsByHead([bookmark.name])
        const pull = fresh.get(bookmark.name)
        if (pull) {
            prByBookmark.set(bookmark.name, pull.number)
            journal.entries.push({
                type: "PrCreated",
                prNumber: pull.number,
                head: bookmark.name,
            })
        }
    }

    for (const effect of plan.effects) {
        if (effect.type === "rebase" && effect.to) {
            const result = await jjRebase(effect.bookmark, effect.to, {
                mode: "descendants",
                skipEmptied: true,
                observer: options.observer,
            })
            if (!result.success) throw new Error(result.stderr || result.stdout)
            journal.entries.push({
                type: "BookmarkRebased",
                bookmark: effect.bookmark,
                from: effect.from,
                to: effect.to,
            })
        }
        if (effect.type === "push") {
            if (pushedBookmarks.has(effect.bookmark)) continue
            const result = await jjGitPushBookmark(effect.bookmark, options)
            if (!result.success) throw new Error(result.stderr || result.stdout)
            journal.entries.push({
                type: "BookmarkPushed",
                bookmark: effect.bookmark,
            })
        }
        if (effect.type === "update-pr" && effect.prNumber && effect.to) {
            const result = await ghPrEditBase(
                effect.prNumber,
                effect.to,
                options,
            )
            if (!result.success) throw new Error(result.stderr || result.stdout)
            journal.entries.push({
                type: "PrBaseChanged",
                prNumber: effect.prNumber,
                from: effect.from,
                to: effect.to,
            })
        }
        if (effect.type === "close-pr" && effect.prNumber) {
            const result = await ghPrClose(effect.prNumber, options)
            if (!result.success) throw new Error(result.stderr || result.stdout)
            journal.entries.push({
                type: "PrClosed",
                prNumber: effect.prNumber,
            })
        }
    }

    const stackPrNumbers = plan.rows
        .map((row) => prByBookmark.get(row.row.bookmark.name) ?? row.prNumber)
        .filter((number): number is number => typeof number === "number")
    for (const row of plan.rows) {
        const prNumber = prByBookmark.get(row.row.bookmark.name) ?? row.prNumber
        if (!prNumber) continue
        const result = await ghUpsertStackComment(
            prNumber,
            renderStackComment(prNumber, stackPrNumbers),
            options,
        )
        if (!result.success) throw new Error(result.stderr || result.stdout)
        journal.entries.push({ type: "StackCommentUpdated", prNumber })
    }

    return prByBookmark
}

async function persistStackStateFromPlan(
    plan: StackPlan<FreshBookmark>,
    prByBookmark: ReadonlyMap<string, number>,
) {
    const previous = await readPersistedStackState()
    const nextByBookmark = new Map(
        previous.entries.map((entry) => [entry.bookmark, entry]),
    )
    const syncedAt = new Date().toISOString()

    for (const row of plan.rows) {
        const bookmark = row.row.bookmark
        const parent = row.desiredBase
        if (!parent || parent === bookmark.name) continue
        const isTrunk =
            row.row.depth === 0 && plan.stackRootName !== bookmark.name
        if (isTrunk) continue
        const prNumber = prByBookmark.get(bookmark.name) ?? row.prNumber
        if (
            !prNumber &&
            row.effects.some((effect) => effect.type === "create-pr")
        ) {
            continue
        }
        const parentRow = plan.rows.find(
            (candidate) => candidate.row.bookmark.name === parent,
        )
        const entry: PersistedStackEntry = {
            bookmark: bookmark.name,
            parent,
            ...(prNumber ? { prNumber } : {}),
            ...(bookmark.changeId ? { headChangeId: bookmark.changeId } : {}),
            headCommitId: bookmark.commitId,
            ...(parentRow?.row.bookmark.changeId
                ? { parentChangeId: parentRow.row.bookmark.changeId }
                : {}),
            ...(parentRow?.row.bookmark.commitId
                ? { parentCommitId: parentRow.row.bookmark.commitId }
                : {}),
            baseRefName: parent,
            syncedAt,
        }
        nextByBookmark.set(bookmark.name, entry)
    }

    await writePersistedStackState({
        version: 1,
        entries: [...nextByBookmark.values()],
    })
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

interface StackJournalFile {
    version: 1
    id: string
    kind: "sync"
    stackRootName: string
    beforeOperationId: string
    afterOperationId?: string
    createdAt: string
    entries: Array<Record<string, unknown>>
}

function stackJournal(
    plan: StackPlan<FreshBookmark>,
    beforeOperationId: string,
): StackJournalFile {
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

async function writeJournal(journal: StackJournalFile) {
    const dir = `${stackJournalRoot()}/${repoCacheKey()}`
    await import("node:fs/promises").then((fs) =>
        fs.mkdir(dir, { recursive: true }),
    )
    await Bun.write(
        `${dir}/${journal.id}.json`,
        `${JSON.stringify(journal, null, 2)}\n`,
    )
}

function stackJournalRoot() {
    const cacheHome =
        process.env.XDG_CACHE_HOME || `${process.env.HOME ?? ""}/.cache`
    return `${cacheHome}/kajji/stack-journal`
}

function repoCacheKey() {
    return Buffer.from(getRepoPath()).toString("base64url")
}
