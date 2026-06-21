import { Effect } from "effect"
import type {
    BookmarkStackModel,
    BookmarkStackRow,
    StackBookmarkInput,
    StackCommitInput,
} from "./model"

export interface BuildBookmarkStackModelOptions<
    TBookmark extends StackBookmarkInput,
> {
    readonly commits: readonly StackCommitInput[]
    readonly bookmarks: readonly TBookmark[]
    /** Preserve current panel order when sorting children and flat rows. */
    readonly sourceOrder?: ReadonlyMap<string, number>
}

export const buildBookmarkStackModel = Effect.fn("Stack.buildBookmarkModel")(
    function* <TBookmark extends StackBookmarkInput>({
        commits,
        bookmarks,
        sourceOrder,
    }: BuildBookmarkStackModelOptions<TBookmark>) {
        const commitsByCommitId = new Map(
            commits.map((commit) => [commit.commitId, commit]),
        )
        const order =
            sourceOrder ??
            new Map(bookmarks.map((bookmark, index) => [bookmark.name, index]))
        const candidates = bookmarks.filter(
            (bookmark) => bookmark.changeId && bookmark.commitId,
        )
        const candidateNames = new Set(
            candidates.map((bookmark) => bookmark.name),
        )
        const bookmarkCommitIds = new Map(
            candidates.map((bookmark) => [bookmark.name, bookmark.commitId]),
        )
        const trunkNames = new Set(
            candidates
                .filter(
                    (bookmark) =>
                        commitsByCommitId.get(bookmark.commitId)?.immutable,
                )
                .map((bookmark) => bookmark.name),
        )
        const defaultTrunk =
            candidates.find((bookmark) => trunkNames.has(bookmark.name)) ?? null

        const parentByName = new Map<string, string>()
        for (const bookmark of candidates) {
            if (trunkNames.has(bookmark.name)) continue
            const bookmarkCommitId = bookmarkCommitIds.get(bookmark.name)
            if (!bookmarkCommitId) continue

            let parent: TBookmark | undefined
            let parentDistance = Number.POSITIVE_INFINITY
            for (const possibleParent of candidates) {
                if (possibleParent.name === bookmark.name) continue
                if (trunkNames.has(possibleParent.name)) continue
                const possibleParentCommitId = bookmarkCommitIds.get(
                    possibleParent.name,
                )
                if (!possibleParentCommitId) continue
                const distance = ancestorDistance(
                    possibleParentCommitId,
                    bookmarkCommitId,
                    commitsByCommitId,
                )
                if (distance < parentDistance) {
                    parent = possibleParent
                    parentDistance = distance
                }
            }

            if (parent) parentByName.set(bookmark.name, parent.name)
        }

        const stackRootNames = new Set(parentByName.values())
        if (defaultTrunk) {
            for (const bookmark of candidates) {
                if (trunkNames.has(bookmark.name)) continue
                if (parentByName.has(bookmark.name)) continue
                if (!stackRootNames.has(bookmark.name)) continue
                parentByName.set(bookmark.name, defaultTrunk.name)
            }
        }

        const childrenByName = new Map<string, TBookmark[]>()
        for (const bookmark of bookmarks) {
            const parent = parentByName.get(bookmark.name)
            if (!parent || !candidateNames.has(parent)) continue
            const children = childrenByName.get(parent) ?? []
            children.push(bookmark)
            childrenByName.set(parent, children)
        }
        for (const children of childrenByName.values()) {
            children.sort(
                (a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0),
            )
        }

        const rows: BookmarkStackRow<TBookmark>[] = []
        const seen = new Set<string>()
        const visit = (
            bookmark: TBookmark,
            depth: number,
            stackKey?: string,
        ) => {
            if (seen.has(bookmark.name)) return
            seen.add(bookmark.name)

            const isTrunk = trunkNames.has(bookmark.name)
            const currentStackKey =
                stackKey ??
                (!isTrunk && childrenByName.has(bookmark.name)
                    ? bookmark.name
                    : undefined)
            const targetStackKeys = isTrunk
                ? (childrenByName.get(bookmark.name) ?? []).map(
                      (child) => child.name,
                  )
                : []
            const stackKeys = isTrunk
                ? targetStackKeys
                : currentStackKey
                  ? [currentStackKey]
                  : []
            rows.push({ bookmark, depth, stackKeys })

            for (const child of childrenByName.get(bookmark.name) ?? []) {
                visit(child, depth + 1, currentStackKey)
            }
        }

        for (const bookmark of bookmarks) {
            if (parentByName.has(bookmark.name)) continue
            visit(bookmark, 0)
        }
        for (const bookmark of bookmarks) visit(bookmark, 0)

        return {
            rows,
            parentByName,
            childrenByName,
            trunkNames,
            stackRootNames,
        } satisfies BookmarkStackModel<TBookmark>
    },
)

const ancestorDistance = (
    ancestorCommitId: string,
    descendantCommitId: string,
    commitsByCommitId: ReadonlyMap<string, StackCommitInput>,
) => {
    const pending: Array<{ commitId: string; distance: number }> = [
        { commitId: descendantCommitId, distance: 0 },
    ]
    const seen = new Set<string>()
    while (pending.length > 0) {
        const item = pending.shift()
        if (!item || seen.has(item.commitId)) continue
        seen.add(item.commitId)
        const commit = commitsByCommitId.get(item.commitId)
        if (!commit) continue
        for (const parentCommitId of commit.parentCommitIds ?? []) {
            if (parentCommitId === ancestorCommitId) return item.distance + 1
            pending.push({
                commitId: parentCommitId,
                distance: item.distance + 1,
            })
        }
    }
    return Number.POSITIVE_INFINITY
}
