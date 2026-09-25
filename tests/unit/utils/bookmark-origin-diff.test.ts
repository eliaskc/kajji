import { describe, expect, test } from "bun:test"
import type { Bookmark } from "../../../src/commander/bookmarks"
import type { Commit } from "../../../src/commander/types"
import {
    findCommitBookmarkWithOriginDiff,
    resetToOriginUnavailableReason,
} from "../../../src/utils/bookmark-origin-diff"

function makeCommit(overrides: Partial<Commit> = {}): Commit {
    return {
        changeId: "change-1",
        commitId: "commit-1",
        description: "test commit",
        author: "Test",
        authorEmail: "test@example.com",
        timestamp: "2026-01-01 00:00:00",
        lines: [],
        displayLines: [],
        refLine: "",
        isWorkingCopy: false,
        immutable: false,
        inTrunk: false,
        empty: false,
        divergent: false,
        conflict: false,
        bookmarks: [],
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
        const result = findCommitBookmarkWithOriginDiff(makeCommit({ bookmarks: ["feature"] }), [
            makeBookmark(),
            makeBookmark({
                isLocal: false,
                remote: "origin",
                commitId: "remote-commit",
            }),
        ])

        expect(result).toBe("feature")
    })

    test("returns null when the local bookmark matches origin", () => {
        const result = findCommitBookmarkWithOriginDiff(makeCommit({ bookmarks: ["feature"] }), [
            makeBookmark({ commitId: "same-commit" }),
            makeBookmark({
                isLocal: false,
                remote: "origin",
                commitId: "same-commit",
            }),
        ])

        expect(result).toBeNull()
    })

    test("returns a selected commit bookmark when there is no origin bookmark", () => {
        const result = findCommitBookmarkWithOriginDiff(makeCommit({ bookmarks: ["feature"] }), [
            makeBookmark(),
            makeBookmark({
                isLocal: false,
                remote: "upstream",
                commitId: "remote-commit",
            }),
        ])

        expect(result).toBe("feature")
    })
})

describe("resetToOriginUnavailableReason", () => {
    const origin = (overrides: Partial<Bookmark> = {}) =>
        makeBookmark({ isLocal: false, remote: "origin", commitId: "remote-commit", ...overrides })

    test("allows a reset when the local bookmark differs from origin", () => {
        expect(
            resetToOriginUnavailableReason(makeBookmark(), [makeBookmark(), origin()]),
        ).toBeNull()
    })

    test("allows a reset that restores a deleted local bookmark", () => {
        const deleted = makeBookmark({ changeId: "", commitId: "" })
        expect(resetToOriginUnavailableReason(deleted, [deleted, origin()])).toBeNull()
    })

    test("rejects a bookmark that already matches origin", () => {
        const local = makeBookmark({ commitId: "remote-commit" })
        expect(resetToOriginUnavailableReason(local, [local, origin()])).toBe(
            "already matches origin",
        )
    })

    test("rejects a local-only bookmark", () => {
        const local = makeBookmark()
        expect(resetToOriginUnavailableReason(local, [local, origin({ remote: "upstream" })])).toBe(
            "has no origin bookmark",
        )
    })

    test("rejects a bookmark that is deleted on origin", () => {
        const local = makeBookmark()
        expect(resetToOriginUnavailableReason(local, [local])).toBe("has no origin bookmark")
    })

    test("rejects a missing or remote bookmark", () => {
        expect(resetToOriginUnavailableReason(undefined, [])).toBe("needs a local bookmark")
        expect(resetToOriginUnavailableReason(origin(), [origin()])).toBe("needs a local bookmark")
    })
})
