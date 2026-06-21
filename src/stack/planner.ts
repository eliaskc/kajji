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
    readonly landedRangesByBookmark?: ReadonlyMap<string, string>
}

export const buildSyncPlan = Effect.fn("Stack.plan.sync")(
    <TBookmark extends StackBookmarkInput>(
        options: BuildStackPlanOptions<TBookmark>,
    ) => Effect.succeed(buildSyncPlanSync(options)),
)

export function buildSyncPlanSync<TBookmark extends StackBookmarkInput>({
    stackRootName,
    stackModel,
    pullRequestsByHead,
    remoteBookmarksByName = new Map(),
    landedRangesByBookmark = new Map(),
}: BuildStackPlanOptions<TBookmark>): StackPlan<TBookmark> {
    const rows = stackRows(stackRootName, stackModel)
    const planRows: StackPlanRow<TBookmark>[] = []
    const effects: StackPlanEffect[] = []
    let blockedByClosedUnmerged: StackPullRequestInput | undefined
    const mergedTargetByName = new Map<string, string>()
    const stackHasMergedPull = rows.some(
        (row) => pullRequestsByHead.get(row.bookmark.name)?.merged === true,
    )
    const rebasedBranchNames = new Set<string>()

    for (const row of rows) {
        const bookmark = row.bookmark
        const pull = pullRequestsByHead.get(bookmark.name)
        const localBase = desiredLocalBase(bookmark.name, stackModel)
        const inheritedMergedTarget = mergedTargetByName.get(localBase)
        const desiredBase = inheritedMergedTarget ?? localBase
        const isTrunk = stackModel.trunkNames.has(bookmark.name)
        const remote = remoteBookmarksByName.get(bookmark.name)
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
            if (!pull) {
                if (needsPush)
                    rowEffects.push({ type: "push", bookmark: bookmark.name })
                rowEffects.push({
                    type: "create-pr",
                    bookmark: bookmark.name,
                    to: desiredBase,
                })
            } else if (pull.merged === true) {
                mergedTargetByName.set(
                    bookmark.name,
                    pull.baseRefName ?? localBase,
                )
                if (!remote) {
                    rowEffects.push({
                        type: "abandon",
                        bookmark: bookmark.name,
                        prNumber: pull.number,
                        reason: "PR was merged and remote bookmark is gone",
                        revision: `${desiredBase}..${bookmark.changeId ?? bookmark.name}`,
                    })
                }
            }
            const landedRange = landedRangesByBookmark.get(bookmark.name)
            if (
                landedRange &&
                pull?.merged !== true &&
                !mergedTargetByName.has(localBase)
            ) {
                rowEffects.push({
                    type: "abandon-landed-range",
                    bookmark: bookmark.name,
                    prNumber: pull?.number,
                    range: landedRange,
                    reason: "parent PR was merged outside kajji",
                })
            }
            if (
                pull &&
                needsPush &&
                pull.merged !== true &&
                desiredBase === localBase &&
                !rebasedBranchNames.has(localBase)
            ) {
                rowEffects.push({ type: "push", bookmark: bookmark.name })
            }
            if (rebasedBranchNames.has(localBase) && pull?.merged !== true) {
                rowEffects.push({ type: "push", bookmark: bookmark.name })
            }
            if (desiredBase !== localBase) {
                rowEffects.push({
                    type: "rebase",
                    bookmark: bookmark.name,
                    prNumber: pull?.number,
                    from: localBase,
                    to: desiredBase,
                })
                if (!rowEffects.some((effect) => effect.type === "push")) {
                    rowEffects.push({
                        type: "push",
                        bookmark: bookmark.name,
                    })
                }
                rebasedBranchNames.add(bookmark.name)
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
            if (
                pull?.number &&
                pull.state !== "CLOSED" &&
                pull.state !== "MERGED" &&
                !stackHasMergedPull
            ) {
                rowEffects.push({
                    type: "update-comment",
                    bookmark: bookmark.name,
                    prNumber: pull.number,
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
    kind: "sync",
    stackRootName: string,
    rows: readonly StackPlanRow<TBookmark>[],
    effects: readonly StackPlanEffect[],
    applyCommand: string,
): StackPlan<TBookmark> {
    const orderedEffects = orderStackEffects(effects)
    return {
        kind,
        stackRootName,
        rows,
        effects: orderedEffects,
        updatePrNumbers: uniqueNumbers(
            orderedEffects
                .filter((e) => e.type === "update-pr" && e.prNumber)
                .map((e) => e.prNumber ?? 0),
        ),
        createPrBookmarks: uniqueStrings(
            orderedEffects
                .filter((e) => e.type === "create-pr")
                .map((e) => e.bookmark),
        ),
        pushBookmarks: uniqueStrings(
            orderedEffects
                .filter((e) => e.type === "push")
                .map((e) => e.bookmark),
        ),
        rebaseBookmarks: uniqueStrings(
            orderedEffects
                .filter((e) => e.type === "rebase")
                .map((e) => e.bookmark),
        ),
        abandonBookmarks: uniqueStrings(
            orderedEffects
                .filter(
                    (e) =>
                        e.type === "abandon" ||
                        e.type === "abandon-landed-range",
                )
                .map((e) => e.bookmark),
        ),
        closePrNumbers: uniqueNumbers(
            orderedEffects
                .filter((e) => e.type === "close-pr" && e.prNumber)
                .map((e) => e.prNumber ?? 0),
        ),
        applyCommand,
    }
}

function orderStackEffects(
    effects: readonly StackPlanEffect[],
): readonly StackPlanEffect[] {
    return effects
        .map((effect, index) => ({ effect, index }))
        .sort((a, b) => {
            const priorityDiff =
                stackEffectPriority(a.effect) - stackEffectPriority(b.effect)
            return priorityDiff || a.index - b.index
        })
        .map(({ effect }) => effect)
}

function stackEffectPriority(effect: StackPlanEffect) {
    switch (effect.type) {
        case "blocked":
            return 0
        case "close-pr":
            return 10
        case "abandon":
        case "abandon-landed-range":
            return 20
        case "rebase":
            return 30
        case "push":
            return 40
        case "create-pr":
            return 50
        case "update-pr":
            return 60
        case "update-comment":
            return 70
    }
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
    const creates = effects.some((effect) => effect.type === "create-pr")
    const comments = effects.some((effect) => effect.type === "update-comment")
    const abandons = effects.some(
        (effect) =>
            effect.type === "abandon" || effect.type === "abandon-landed-range",
    )
    const rebases = effects.some((effect) => effect.type === "rebase")
    const pushes = effects.some((effect) => effect.type === "push")
    const retargets = effects.some((effect) => effect.type === "update-pr")
    if (effects.some((effect) => effect.type === "abandon-landed-range"))
        return "would abandon landed parent range"
    if (abandons) return "would abandon merged local change"
    if (creates && pushes) return `would push and create PR onto ${desiredBase}`
    if (creates) return `would create PR onto ${desiredBase}`
    if (rebases && retargets && pushes)
        return `would rebase, push, and retarget onto ${desiredBase}`
    if (rebases && retargets)
        return `would rebase and retarget onto ${desiredBase}`
    if (rebases && pushes) return `would rebase and push onto ${desiredBase}`
    if (rebases) return `would rebase onto ${desiredBase}`
    if (retargets && pushes)
        return `would push and retarget PR onto ${desiredBase}`
    if (retargets) return `would retarget PR onto ${desiredBase}`
    if (pushes) return "would push"
    if (comments) return "would update stack comment"
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
