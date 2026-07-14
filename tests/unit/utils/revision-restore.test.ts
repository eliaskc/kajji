import { describe, expect, test } from "bun:test"
import type { Commit } from "../../../src/commander/types"
import { getRevisionRestorePlan } from "../../../src/utils/revision-restore"

const commit = (overrides: Partial<Commit> = {}): Commit =>
    ({
        changeId: "change-id",
        commitId: "commit-id",
        parentCommitIds: ["parent-id"],
        isWorkingCopy: false,
        immutable: false,
        divergent: false,
        ...overrides,
    }) as Commit

describe("getRevisionRestorePlan", () => {
    test("uses the default restore behavior for the working copy", () => {
        expect(getRevisionRestorePlan(commit({ isWorkingCopy: true }))).toEqual(
            { supported: true },
        )
    })

    test("rewrites a mutable single-parent revision from its parent", () => {
        expect(getRevisionRestorePlan(commit())).toEqual({
            supported: true,
            from: "parent-id",
            into: "change-id",
        })
    })

    test("uses the commit ID for a divergent revision", () => {
        expect(
            getRevisionRestorePlan(commit({ divergent: true })),
        ).toMatchObject({ into: "commit-id" })
    })

    test("explains unsupported immutable and merge revisions", () => {
        expect(
            getRevisionRestorePlan(commit({ immutable: true })),
        ).toMatchObject({ supported: false, message: expect.any(String) })
        expect(
            getRevisionRestorePlan(commit({ parentCommitIds: ["one", "two"] })),
        ).toMatchObject({ supported: false, message: expect.any(String) })
    })
})
