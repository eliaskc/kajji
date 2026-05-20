import { Effect } from "effect"
import type {
    BookmarkStackModel,
    BookmarkStackRow,
    StackBookmarkInput,
    StackPlan,
    StackPlanEffect,
    StackPlanRow,
    StackPullRequestInput,
    StackRemoteBookmarkInput,
} from "./model"

export interface BuildStackPlanOptions<TBookmark extends StackBookmarkInput> {
    readonly stackRootName: string
    readonly stackModel: BookmarkStackModel<TBookmark>
    readonly pullRequestsByHead: ReadonlyMap<string, StackPullRequestInput>
    readonly remoteBookmarksByName?: ReadonlyMap<
        string,
        StackRemoteBookmarkInput
    >
}

export const buildSubmitPlan = Effect.fn("Stack.plan.submit")(
    <TBookmark extends StackBookmarkInput>(
        options: BuildStackPlanOptions<TBookmark>,
    ) => Effect.succeed(buildSubmitPlanSync(options)),
)

export const buildSyncPlan = Effect.fn("Stack.plan.sync")(
    <TBookmark extends StackBookmarkInput>(
        options: BuildStackPlanOptions<TBookmark>,
    ) => Effect.succeed(buildSyncPlanSync(options)),
)

export function buildSubmitPlanSync<TBookmark extends StackBookmarkInput>({
    stackRootName,
    stackModel,
    pullRequestsByHead,
    remoteBookmarksByName = new Map(),
}: BuildStackPlanOptions<TBookmark>): StackPlan<TBookmark> {
    const rows = stackRows(stackRootName, stackModel)
    const planRows: StackPlanRow<TBookmark>[] = []
    const effects: StackPlanEffect[] = []

    for (const row of rows) {
        const bookmark = row.bookmark
        const desiredBase = desiredLocalBase(bookmark.name, stackModel)
        const pull = pullRequestsByHead.get(bookmark.name)
        const remote = remoteBookmarksByName.get(bookmark.name)
        const isTrunk = stackModel.trunkNames.has(bookmark.name)
        const rowEffects: StackPlanEffect[] = []
        const needsPush = Boolean(
            !isTrunk &&
                bookmark.commitId &&
                (!remote || remote.commitId !== bookmark.commitId),
        )

        if (isTrunk) {
            planRows.push(rowPlan(row, pull, desiredBase, rowEffects, ""))
            continue
        }

        if (needsPush) {
            rowEffects.push({ type: "push", bookmark: bookmark.name })
        }

        if (!pull) {
            rowEffects.push({
                type: "create-pr",
                bookmark: bookmark.name,
                to: desiredBase,
            })
        } else {
            if (pull.baseRefName && pull.baseRefName !== desiredBase) {
                rowEffects.push({
                    type: "update-pr",
                    bookmark: bookmark.name,
                    prNumber: pull.number,
                    from: pull.baseRefName,
                    to: desiredBase,
                })
            }
            rowEffects.push({
                type: "update-comment",
                bookmark: bookmark.name,
                prNumber: pull.number,
            })
        }

        effects.push(...rowEffects)
        planRows.push(
            rowPlan(
                row,
                pull,
                desiredBase,
                rowEffects,
                submitNote(rowEffects, desiredBase),
            ),
        )
    }

    return makePlan("submit", stackRootName, planRows, effects, "stack submit")
}

export function buildSyncPlanSync<TBookmark extends StackBookmarkInput>({
    stackRootName,
    stackModel,
    pullRequestsByHead,
}: BuildStackPlanOptions<TBookmark>): StackPlan<TBookmark> {
    const rows = stackRows(stackRootName, stackModel)
    const planRows: StackPlanRow<TBookmark>[] = []
    const effects: StackPlanEffect[] = []
    let blockedByClosedUnmerged: StackPullRequestInput | undefined
    const mergedTargetByName = new Map<string, string>()

    for (const row of rows) {
        const bookmark = row.bookmark
        const pull = pullRequestsByHead.get(bookmark.name)
        const localBase = desiredLocalBase(bookmark.name, stackModel)
        const inheritedMergedTarget = mergedTargetByName.get(localBase)
        const desiredBase =
            inheritedMergedTarget ?? pull?.baseRefName ?? localBase
        const isTrunk = stackModel.trunkNames.has(bookmark.name)
        const rowEffects: StackPlanEffect[] = []

        if (isTrunk) {
            planRows.push(rowPlan(row, pull, desiredBase, rowEffects, ""))
            continue
        }

        if (blockedByClosedUnmerged) {
            if (pull?.number && pull.state !== "CLOSED") {
                rowEffects.push({
                    type: "close-pr",
                    bookmark: bookmark.name,
                    prNumber: pull.number,
                    reason: `parent #${blockedByClosedUnmerged.number} was closed without merging`,
                })
            } else {
                rowEffects.push({
                    type: "blocked",
                    bookmark: bookmark.name,
                    reason: `parent #${blockedByClosedUnmerged.number} was closed without merging`,
                })
            }
            effects.push(...rowEffects)
            planRows.push(
                rowPlan(
                    row,
                    pull,
                    desiredBase,
                    rowEffects,
                    syncNote(rowEffects, desiredBase),
                ),
            )
            continue
        }

        if (pull?.state === "CLOSED" && pull.merged === false) {
            blockedByClosedUnmerged = pull
            rowEffects.push({
                type: "blocked",
                bookmark: bookmark.name,
                prNumber: pull.number,
                reason: "PR was closed without merging",
            })
        } else {
            if (pull?.merged === true) {
                mergedTargetByName.set(
                    bookmark.name,
                    pull.baseRefName ?? localBase,
                )
                rowEffects.push({
                    type: "abandon",
                    bookmark: bookmark.name,
                    prNumber: pull.number,
                    reason: "PR was merged",
                    revision: `${desiredBase}..${bookmark.changeId ?? bookmark.name}`,
                })
            }
            if (desiredBase !== localBase) {
                rowEffects.push({
                    type: "rebase",
                    bookmark: bookmark.name,
                    prNumber: pull?.number,
                    from: localBase,
                    to: desiredBase,
                })
                rowEffects.push({
                    type: "push",
                    bookmark: bookmark.name,
                })
            }
            if (
                pull?.number &&
                pull.state !== "CLOSED" &&
                pull.state !== "MERGED" &&
                pull.baseRefName !== desiredBase
            ) {
                rowEffects.push({
                    type: "update-pr",
                    bookmark: bookmark.name,
                    prNumber: pull.number,
                    from: pull.baseRefName,
                    to: desiredBase,
                })
            }
        }

        effects.push(...rowEffects)
        planRows.push(
            rowPlan(
                row,
                pull,
                desiredBase,
                rowEffects,
                syncNote(rowEffects, desiredBase),
            ),
        )
    }

    return makePlan("sync", stackRootName, planRows, effects, "stack sync")
}

function rowPlan<TBookmark extends StackBookmarkInput>(
    row: BookmarkStackRow<TBookmark>,
    pull: StackPullRequestInput | undefined,
    desiredBase: string,
    effects: readonly StackPlanEffect[],
    fallbackNote: string,
): StackPlanRow<TBookmark> {
    return {
        row,
        prNumber: pull?.number,
        desiredBase,
        status: effects[0]?.type ?? "current",
        note: fallbackNote,
        effects,
    }
}

function makePlan<TBookmark extends StackBookmarkInput>(
    kind: "submit" | "sync",
    stackRootName: string,
    rows: readonly StackPlanRow<TBookmark>[],
    effects: readonly StackPlanEffect[],
    applyCommand: string,
): StackPlan<TBookmark> {
    return {
        kind,
        stackRootName,
        rows,
        effects,
        updatePrNumbers: uniqueNumbers(
            effects
                .filter((e) => e.type === "update-pr" && e.prNumber)
                .map((e) => e.prNumber ?? 0),
        ),
        createPrBookmarks: uniqueStrings(
            effects
                .filter((e) => e.type === "create-pr")
                .map((e) => e.bookmark),
        ),
        pushBookmarks: uniqueStrings(
            effects.filter((e) => e.type === "push").map((e) => e.bookmark),
        ),
        rebaseBookmarks: uniqueStrings(
            effects.filter((e) => e.type === "rebase").map((e) => e.bookmark),
        ),
        abandonBookmarks: uniqueStrings(
            effects.filter((e) => e.type === "abandon").map((e) => e.bookmark),
        ),
        closePrNumbers: uniqueNumbers(
            effects
                .filter((e) => e.type === "close-pr" && e.prNumber)
                .map((e) => e.prNumber ?? 0),
        ),
        applyCommand,
    }
}

function submitNote(effects: readonly StackPlanEffect[], desiredBase: string) {
    if (effects.some((effect) => effect.type === "create-pr")) {
        return `would create PR onto ${desiredBase}`
    }
    if (effects.some((effect) => effect.type === "update-pr")) {
        return `would retarget PR onto ${desiredBase}`
    }
    if (effects.some((effect) => effect.type === "push"))
        return "would push bookmark"
    if (effects.some((effect) => effect.type === "update-comment"))
        return "would update stack comment"
    return `targets ${desiredBase}`
}

function syncNote(effects: readonly StackPlanEffect[], desiredBase: string) {
    const closePr = effects.find((effect) => effect.type === "close-pr")
    if (closePr) {
        return closePr.reason
            ? `would close PR: ${closePr.reason}`
            : "would close descendant PR"
    }
    const blocked = effects.find((effect) => effect.type === "blocked")
    if (blocked) {
        return blocked.reason ? `blocked: ${blocked.reason}` : "blocked"
    }
    const abandons = effects.some((effect) => effect.type === "abandon")
    const rebases = effects.some((effect) => effect.type === "rebase")
    const pushes = effects.some((effect) => effect.type === "push")
    const retargets = effects.some((effect) => effect.type === "update-pr")
    if (abandons) return "would abandon merged local change"
    if (rebases && retargets && pushes)
        return `would rebase, push, and retarget onto ${desiredBase}`
    if (rebases && retargets)
        return `would rebase and retarget onto ${desiredBase}`
    if (rebases && pushes) return `would rebase and push onto ${desiredBase}`
    if (rebases) return `would rebase onto ${desiredBase}`
    if (retargets) return `would retarget PR onto ${desiredBase}`
    return `targets ${desiredBase}`
}

function stackRows<TBookmark extends StackBookmarkInput>(
    stackRootName: string,
    stackModel: BookmarkStackModel<TBookmark>,
): readonly BookmarkStackRow<TBookmark>[] {
    const rows = stackModel.rows.filter((row) =>
        row.stackKeys.includes(stackRootName),
    )
    const minDepth = Math.min(...rows.map((row) => row.depth))
    return rows.map((row) => ({
        ...row,
        depth: Math.max(0, row.depth - minDepth),
    }))
}

function desiredLocalBase<TBookmark extends StackBookmarkInput>(
    bookmarkName: string,
    stackModel: BookmarkStackModel<TBookmark>,
): string {
    return stackModel.parentByName.get(bookmarkName) ?? bookmarkName
}

const uniqueStrings = (values: readonly string[]) => [...new Set(values)]
const uniqueNumbers = (values: readonly number[]) => [...new Set(values)]
