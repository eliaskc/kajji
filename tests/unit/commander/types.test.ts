import { describe, expect, test } from "bun:test"
import { type Commit, getRevisionId } from "../../../src/commander/types"

function makeCommit(overrides: Partial<Commit> = {}): Commit {
    return {
        changeId: "abcd1234",
        commitId: "ff001122",
        description: "test commit",
        author: "Test",
        authorEmail: "test@test.com",
        timestamp: "2025-01-01 00:00:00",
        lines: [],
        displayLines: [],
        refLine: "",
        isWorkingCopy: false,
        immutable: false,
        inTrunk: false,
        empty: false,
        divergent: false,
        bookmarks: [],
        gitHead: false,
        workingCopies: [],
        ...overrides,
    }
}

describe("getRevisionId", () => {
    test("returns changeId for non-divergent commits", () => {
        const commit = makeCommit({
            changeId: "abcd1234",
            commitId: "ff001122",
            divergent: false,
        })
        expect(getRevisionId(commit)).toBe("abcd1234")
    })

    test("returns commitId for divergent commits", () => {
        const commit = makeCommit({
            changeId: "abcd1234",
            commitId: "ff001122",
            divergent: true,
        })
        expect(getRevisionId(commit)).toBe("ff001122")
    })

    test("handles empty changeId on non-divergent commit", () => {
        const commit = makeCommit({
            changeId: "",
            commitId: "ff001122",
            divergent: false,
        })
        expect(getRevisionId(commit)).toBe("")
    })

    test("handles empty commitId on divergent commit", () => {
        const commit = makeCommit({
            changeId: "abcd1234",
            commitId: "",
            divergent: true,
        })
        expect(getRevisionId(commit)).toBe("")
    })
})
