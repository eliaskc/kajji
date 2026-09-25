import { describe, expect, test } from "bun:test"
import type { BookmarkResetPlan } from "../../../src/application/bookmark-reset"
import {
    resetMenuFooter,
    resetMenuOption,
    resetMenuSummary,
} from "../../../src/utils/bookmark-reset-copy"

function makePlan(overrides: Partial<BookmarkResetPlan> = {}): BookmarkResetPlan {
    return {
        name: "feature",
        localCommitIds: ["local"],
        originCommitId: "origin",
        localOnly: [{ changeId: "c", commitId: "local", description: "feature" }],
        sameContent: false,
        descendants: 0,
        affectsWorkingCopy: false,
        ...overrides,
    }
}

const commit = (id: string) => ({ changeId: id, commitId: id, description: id })

describe("reset menu copy", () => {
    test("asks about one local commit", () => {
        const plan = makePlan()
        expect(resetMenuSummary(plan)).toBe(
            "1 local commit is not on origin. What do you want to do with it?",
        )
        expect(resetMenuOption(plan, "abandon").label).toBe("abandon it")
        expect(resetMenuOption(plan, "keep").label).toBe("keep it")
        expect(resetMenuOption(plan, "new-commit").label).toBe("keep its changes as a new commit")
        expect(resetMenuFooter(plan)).toBeUndefined()
    })

    test("uses plural words for several commits", () => {
        const plan = makePlan({ localOnly: [commit("a"), commit("b"), commit("c")] })
        expect(resetMenuSummary(plan)).toBe(
            "3 local commits are not on origin. What do you want to do with them?",
        )
        expect(resetMenuOption(plan, "abandon").label).toBe("abandon them")
        expect(resetMenuOption(plan, "new-commit").label).toBe("keep their changes as a new commit")
    })

    test("mentions same content and working copy rebases", () => {
        const plan = makePlan({ sameContent: true, affectsWorkingCopy: true, descendants: 1 })
        expect(resetMenuSummary(plan)).toBe(
            "1 local commit is not on origin, but the content is the same. What do you want to do with it?",
        )
        expect(resetMenuFooter(plan)).toBe("Note: @ is based on it, so abandoning it rebases @.")
    })

    test("warns about other descendants", () => {
        expect(resetMenuFooter(makePlan({ descendants: 2 }))).toBe(
            "Note: 2 other commits are based on it, so abandoning it rebases them.",
        )
    })
})
