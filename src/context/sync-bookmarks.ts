import type { Bookmark } from "../commander/bookmarks"

export const getVisibleBookmarks = (bookmarks: Bookmark[], limit: number) =>
    bookmarks.filter((bookmark) => bookmark.isLocal).slice(0, limit)
