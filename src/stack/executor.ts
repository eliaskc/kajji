import { Effect } from "effect"
import { type Bookmark, fetchBookmarks } from "../commander/bookmarks"
import {
    type GitHubPullRequestSummary,
    ghListPullRequestsByHead,
    ghPrClose,
    ghPrCreate,
    ghPrEditBase,
    ghPrViewWeb,
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
} from "../commander/operations"
import { getRepoPath } from "../repo"
import { buildBookmarkStackModel } from "./discovery"
import type {
    BookmarkStackModel,
    StackPlan,
    StackPlanEffect,
    StackPullRequestInput,
} from "./model"
import { buildSubmitPlanSync, buildSyncPlanSync } from "./planner"

export interface PrepareStackPlanOptions {
    readonly stackRootName: string
    readonly observer?: CommandObserver
}

export interface ApplyStackPlanOptions {
    readonly observer?: CommandObserver
}

type FreshBookmark = Bookmark

export const prepareSubmitPlan = Effect.fn("Stack.prepareSubmitPlan")(
    (options: PrepareStackPlanOptions) =>
        Effect.promise(async () => {
            const state = await loadFreshState({
                observer: options.observer,
                includeClosedPulls: false,
            })
            return buildSubmitPlanSync({
                stackRootName: options.stackRootName,
                stackModel: state.stackModel,
                pullRequestsByHead: state.pullRequestsByHead,
                remoteBookmarksByName: state.remoteBookmarksByName,
            })
        }),
)

export const prepareSyncPlan = Effect.fn("Stack.prepareSyncPlan")(
    (options: PrepareStackPlanOptions) =>
        Effect.promise(async () => {
            const state = await loadFreshState({
                observer: options.observer,
                includeClosedPulls: true,
            })
            return buildSyncPlanSync({
                stackRootName: options.stackRootName,
                stackModel: state.stackModel,
                pullRequestsByHead: state.pullRequestsByHead,
                remoteBookmarksByName: state.remoteBookmarksByName,
            })
        }),
)

export const applyStackPlan = Effect.fn("Stack.applyPlan")(
    (plan: StackPlan<FreshBookmark>, options: ApplyStackPlanOptions = {}) =>
        Effect.promise(async () => {
            const beforeOp = await fetchOpLogId()
            const journal = stackJournal(plan, beforeOp)
            if (plan.kind === "submit") {
                await applySubmitPlan(plan, journal, options)
            } else {
                await applySyncPlan(plan, journal, options)
            }
            journal.afterOperationId = await fetchOpLogId()
            await writeJournal(journal)
        }),
)

async function loadFreshState(options: {
    readonly observer?: CommandObserver
    readonly includeClosedPulls: boolean
}) {
    const fetchResult = await jjGitFetch({ observer: options.observer })
    if (!fetchResult.success)
        throw new Error(fetchResult.stderr || fetchResult.stdout)

    const [{ commits }, allBookmarks] = await Promise.all([
        fetchLogPage({ limit: 1000 }),
        fetchBookmarks({ allRemotes: true }),
    ])
    const localBookmarks = allBookmarks.filter((bookmark) => bookmark.isLocal)
    const remoteBookmarks = allBookmarks.filter((bookmark) => !bookmark.isLocal)
    const stackModel = Effect.runSync(
        buildBookmarkStackModel({
            commits: commits.map((commit) => ({
                commitId: commit.commitId,
                parentCommitIds: commit.parentCommitIds ?? [],
                immutable: commit.immutable,
            })),
            bookmarks: localBookmarks,
        }),
    )
    const heads = stackModel.rows.map((row) => row.bookmark.name)
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

async function applySubmitPlan(
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
        if (effect.type === "push") {
            const result = await jjGitPushBookmark(effect.bookmark, options)
            if (!result.success) throw new Error(result.stderr || result.stdout)
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
                title: bookmark.description || bookmark.name,
                body: "",
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
        if (effect.type !== "update-pr" || !effect.prNumber || !effect.to)
            continue
        const result = await ghPrEditBase(effect.prNumber, effect.to, options)
        if (!result.success) throw new Error(result.stderr || result.stdout)
        journal.entries.push({
            type: "PrBaseChanged",
            prNumber: effect.prNumber,
            from: effect.from,
            to: effect.to,
        })
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

    const firstPr = stackPrNumbers[0]
    if (firstPr) await ghPrViewWeb(firstPr, options)
}

async function applySyncPlan(
    plan: StackPlan<FreshBookmark>,
    journal: StackJournalFile,
    options: ApplyStackPlanOptions,
) {
    for (const effect of plan.effects) {
        if (effect.type === "rebase" && effect.to) {
            const result = await jjRebase(effect.bookmark, effect.to, {
                mode: "branch",
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

    for (const effect of plan.effects) {
        if (effect.type !== "abandon") continue
        const result = await jjAbandon(effect.bookmark, {
            observer: options.observer,
        })
        if (!result.success) throw new Error(result.stderr || result.stdout)
        journal.entries.push({
            type: "BookmarkAbandoned",
            bookmark: effect.bookmark,
            prNumber: effect.prNumber,
        })
    }
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
    kind: "submit" | "sync"
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
