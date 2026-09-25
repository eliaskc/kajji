export type BookmarkView = "local" | "remote" | "deleted"

const BOOKMARK_VIEWS: readonly BookmarkView[] = ["local", "remote", "deleted"]

export function nextBookmarkView(view: BookmarkView): BookmarkView {
    return BOOKMARK_VIEWS[(BOOKMARK_VIEWS.indexOf(view) + 1) % BOOKMARK_VIEWS.length] ?? "local"
}

/** Label for the right side of the bookmarks panel header. Empty for the default view. */
export const BOOKMARK_VIEW_LABELS: Record<BookmarkView, string> = {
    local: "",
    remote: "remote only",
    deleted: "deleted only",
}
