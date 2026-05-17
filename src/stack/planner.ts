import { Effect } from "effect"
import type {
    BookmarkStackModel,
    BookmarkStackRow,
    StackBookmarkInput,
    StackPlan,
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
    const updatePrNumbers: number[] = []
    const createPrBookmarks: string[] = []
    const pushBookmarks: string[] = []

    for (const row of rows) {
        const bookmark = row.bookmark
        const desiredBase = desiredLocalBase(bookmark.name, stackModel)
        const pull = pullRequestsByHead.get(bookmark.name)
        const remote = remoteBookmarksByName.get(bookmark.name)
        const isTrunk = stackModel.trunkNames.has(bookmark.name)
        const needsPush = Boolean(
            !isTrunk &&
                bookmark.commitId &&
                (!remote || remote.commitId !== bookmark.commitId),
        )

        if (isTrunk) {
            planRows.push({
                row,
                desiredBase,
                status: "current",
                note: "",
            })
            continue
        }

        if (!pull) {
            createPrBookmarks.push(bookmark.name)
            if (needsPush) pushBookmarks.push(bookmark.name)
            planRows.push({
                row,
                desiredBase,
                status: "create-pr",
                note: `would create PR onto ${desiredBase}`,
            })
            continue
        }

        if (pull.baseRefName && pull.baseRefName !== desiredBase) {
            updatePrNumbers.push(pull.number)
            if (needsPush) pushBookmarks.push(bookmark.name)
            planRows.push({
                row,
                prNumber: pull.number,
                desiredBase,
                status: "update-pr",
                note: `would retarget PR onto ${desiredBase}`,
            })
            continue
        }

        if (needsPush) {
            pushBookmarks.push(bookmark.name)
            planRows.push({
                row,
                prNumber: pull.number,
                desiredBase,
                status: "push",
                note: "would push bookmark",
            })
            continue
        }

        planRows.push({
            row,
            prNumber: pull.number,
            desiredBase,
            status: "current",
            note: `targets ${desiredBase}`,
        })
    }

    return {
        kind: "submit",
        stackRootName,
        rows: planRows,
        updatePrNumbers: uniqueNumbers(updatePrNumbers),
        createPrBookmarks: uniqueStrings(createPrBookmarks),
        pushBookmarks: uniqueStrings(pushBookmarks),
        rebaseBookmarks: [],
        applyCommand: "stack submit",
    }
}

export function buildSyncPlanSync<TBookmark extends StackBookmarkInput>({
    stackRootName,
    stackModel,
    pullRequestsByHead,
}: BuildStackPlanOptions<TBookmark>): StackPlan<TBookmark> {
    const rows = stackRows(stackRootName, stackModel)
    const planRows: StackPlanRow<TBookmark>[] = []
    const rebaseBookmarks: string[] = []

    for (const row of rows) {
        const bookmark = row.bookmark
        const pull = pullRequestsByHead.get(bookmark.name)
        const localBase = desiredLocalBase(bookmark.name, stackModel)
        const desiredBase = pull?.baseRefName ?? localBase
        const isTrunk = stackModel.trunkNames.has(bookmark.name)

        if (isTrunk) {
            planRows.push({
                row,
                prNumber: pull?.number,
                desiredBase,
                status: "current",
                note: "",
            })
            continue
        }

        if (desiredBase !== localBase) {
            rebaseBookmarks.push(bookmark.name)
            planRows.push({
                row,
                prNumber: pull?.number,
                desiredBase,
                status: "rebase",
                note: `would rebase onto ${desiredBase}`,
            })
            continue
        }

        planRows.push({
            row,
            prNumber: pull?.number,
            desiredBase,
            status: "current",
            note: `targets ${desiredBase}`,
        })
    }

    return {
        kind: "sync",
        stackRootName,
        rows: planRows,
        updatePrNumbers: [],
        createPrBookmarks: [],
        pushBookmarks: [],
        rebaseBookmarks: uniqueStrings(rebaseBookmarks),
        applyCommand: "stack sync",
    }
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
