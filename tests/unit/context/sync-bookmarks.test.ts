import { describe, expect, test } from "bun:test"
import type { Bookmark } from "../../../src/commander/bookmarks"
import { getVisibleBookmarks } from "../../../src/context/sync-bookmarks"

const makeBookmark = (overrides: Partial<Bookmark>): Bookmark => ({
    name: "",
    nameDisplay: "",
    changeId: "",
    commitId: "",
    changeIdDisplay: "",
    commitIdDisplay: "",
    descriptionDisplay: "",
    description: "",
    isLocal: true,
    ...overrides,
})

describe("getVisibleBookmarks", () => {
    test("does not let remote bookmarks consume local slots", () => {
        const bookmarks: Bookmark[] = [
            makeBookmark({
                name: "here-lays-a-bookmark",
                changeId: "nopurzvt",
                commitId: "81573da7",
                isLocal: true,
            }),
            makeBookmark({
                name: "here-lays-a-bookmark",
                remote: "origin",
                isLocal: false,
            }),
            makeBookmark({
                name: "main",
                changeId: "lymlxluq",
                commitId: "f2f6496e",
                isLocal: true,
            }),
        ]

        const visible = getVisibleBookmarks(bookmarks, 2)
        const visibleLocalNames = visible
            .filter((bookmark) => bookmark.isLocal)
            .map((bookmark) => bookmark.name)

        expect(visibleLocalNames).toEqual(["here-lays-a-bookmark", "main"])
    })

    test("includes all local bookmarks when limit matches locals", () => {
        const bookmarks: Bookmark[] = [
            makeBookmark({ name: "here-lays-a-bookmark", isLocal: true }),
            makeBookmark({ name: "main", isLocal: true }),
        ]

        const visible = getVisibleBookmarks(bookmarks, 2)
        const visibleLocalNames = visible.map((bookmark) => bookmark.name)

        expect(visibleLocalNames).toEqual(["here-lays-a-bookmark", "main"])
    })
})
