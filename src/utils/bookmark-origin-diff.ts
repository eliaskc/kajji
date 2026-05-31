import type { Bookmark } from "../commander/bookmarks"
import type { Commit } from "../commander/types"

export function hasOriginDiff(bookmark: Bookmark, remoteBookmarks: Bookmark[]) {
    if (!bookmark.isLocal || !bookmark.changeId) return false
    const remote = remoteBookmarks.find(
        (remoteBookmark) =>
            !remoteBookmark.isLocal &&
            remoteBookmark.remote === "origin" &&
            remoteBookmark.name === bookmark.name,
    )
    return !remote?.commitId || remote.commitId !== bookmark.commitId
}

export function findCommitBookmarkWithOriginDiff(
    commit: Commit | undefined,
    bookmarks: Bookmark[],
    remoteBookmarks: Bookmark[],
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
            return local && hasOriginDiff(local, remoteBookmarks)
        }) ?? null
    )
}
