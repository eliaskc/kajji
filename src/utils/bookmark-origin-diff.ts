import type { Bookmark } from "../commander/bookmarks"
import type { Commit } from "../commander/types"
import type { StyledSegment } from "../context/dialog"

/**
 * `bookmarks` is the combined local + remote list from
 * `jj bookmark list --all-remotes`, so both sides of the comparison come from
 * the same snapshot.
 */
export function hasOriginDiff(bookmark: Bookmark, bookmarks: Bookmark[]) {
    if (!bookmark.isLocal || !bookmark.changeId) return false
    const remote = bookmarks.find(
        (remoteBookmark) =>
            !remoteBookmark.isLocal &&
            remoteBookmark.remote === "origin" &&
            remoteBookmark.name === bookmark.name,
    )
    return !remote?.commitId || remote.commitId !== bookmark.commitId
}

export function findOriginBookmark(name: string, bookmarks: Bookmark[]) {
    return bookmarks.find(
        (bookmark) => !bookmark.isLocal && bookmark.remote === "origin" && bookmark.name === name,
    )
}

/**
 * Returns why a local bookmark cannot be reset to its origin target, or null
 * when a reset would change it. A deleted local bookmark (no target) with an
 * origin target can be reset: the reset restores it.
 */
export function resetToOriginUnavailableReason(
    bookmark: Bookmark | undefined,
    bookmarks: Bookmark[],
): string | null {
    if (!bookmark?.isLocal) return "needs a local bookmark"
    const origin = findOriginBookmark(bookmark.name, bookmarks)
    if (!origin?.commitId) return "has no origin bookmark"
    if (origin.commitId === bookmark.commitId) return "already matches origin"
    return null
}

export function resetToOriginConfirmMessage(name: string): StyledSegment[] {
    return [{ text: "Reset", style: "action" }, " ", { text: name, style: "target" }, " to origin?"]
}

export function findCommitBookmarkWithOriginDiff(
    commit: Commit | undefined,
    bookmarks: Bookmark[],
) {
    if (!commit) return null
    const localByName = new Map(
        bookmarks
            .filter((bookmark) => bookmark.isLocal)
            .map((bookmark) => [bookmark.name, bookmark]),
    )
    return (
        commit.bookmarks.find((name) => {
            const local = localByName.get(name)
            return local && hasOriginDiff(local, bookmarks)
        }) ?? null
    )
}
