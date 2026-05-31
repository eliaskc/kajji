import { describe, expect, test } from "bun:test"
import type { Bookmark } from "../../../src/commander/bookmarks"
import type { Commit } from "../../../src/commander/types"
import { findCommitBookmarkWithOriginDiff } from "../../../src/utils/bookmark-origin-diff"

function makeCommit(overrides: Partial<Commit> = {}): Commit {
    return {
        changeId: "change-1",
        commitId: "commit-1",
        description: "test commit",
        author: "Test",
        authorEmail: "test@example.com",
        timestamp: "2026-01-01 00:00:00",
        lines: [],
        refLine: "",
        isWorkingCopy: false,
        immutable: false,
        empty: false,
        divergent: false,
        bookmarks: [],
        gitHead: false,
        workingCopies: [],
        ...overrides,
    }
}

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
    return {
        name: "feature",
        nameDisplay: "feature",
        changeId: "change-1",
        commitId: "local-commit",
        changeIdDisplay: "change-1",
        commitIdDisplay: "local-co",
        descriptionDisplay: "test bookmark",
        description: "test bookmark",
        isLocal: true,
        ...overrides,
    }
}

describe("findCommitBookmarkWithOriginDiff", () => {
    test("returns a selected commit bookmark that differs from origin", () => {
        const result = findCommitBookmarkWithOriginDiff(
            makeCommit({ bookmarks: ["feature"] }),
            [makeBookmark()],
            [
                makeBookmark({
                    isLocal: false,
                    remote: "origin",
                    commitId: "remote-commit",
                }),
            ],
        )

        expect(result).toBe("feature")
    })

    test("returns null when the local bookmark matches origin", () => {
        const result = findCommitBookmarkWithOriginDiff(
            makeCommit({ bookmarks: ["feature"] }),
            [makeBookmark({ commitId: "same-commit" })],
            [
                makeBookmark({
                    isLocal: false,
                    remote: "origin",
                    commitId: "same-commit",
                }),
            ],
        )

        expect(result).toBeNull()
    })

    test("returns a selected commit bookmark when there is no origin bookmark", () => {
        const result = findCommitBookmarkWithOriginDiff(
            makeCommit({ bookmarks: ["feature"] }),
            [makeBookmark()],
            [
                makeBookmark({
                    isLocal: false,
                    remote: "upstream",
                    commitId: "remote-commit",
                }),
            ],
        )

        expect(result).toBe("feature")
    })
})
