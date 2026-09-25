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
        conflict: false,
        bookmarks: [],
        workingCopies: [],
        ...overrides,
    }
}

describe("getRevisionId", () => {
    test.each([
        { divergent: false, expected: "abcd1234" },
        { divergent: true, expected: "ff001122" },
    ])("divergent=$divergent uses $expected", ({ divergent, expected }) => {
        expect(getRevisionId(makeCommit({ divergent }))).toBe(expected)
    })
})
