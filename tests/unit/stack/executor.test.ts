import { describe, expect, mock, test } from "bun:test"
import { Effect } from "effect"
import type { Bookmark } from "../../../src/commander/bookmarks"
import type { GitHubPullRequestSummary } from "../../../src/commander/github"
import type { Commit } from "../../../src/commander/types"
import type { StackPlan } from "../../../src/stack/model"

const calls: string[] = []
let fetchLogCalls = 0
let fetchBookmarkCalls = 0

const mainCommit = commit("main-commit", [], true)
const parentCommit = commit("parent-commit", ["main-commit"])
const childCommit = commit("child-commit", ["parent-commit"])

const mainBookmark = bookmark("main", "main-commit", "main-change")
const parentBookmark = bookmark("test/stack", "parent-commit", "parent-change")
const childBookmark = bookmark("test/stack-2", "child-commit", "child-change")

mock.module("../../../src/commander/log", () => ({
    fetchLogPage: mock(async () => {
        fetchLogCalls++
        return {
            commits: [childCommit, parentCommit, mainCommit],
            hasMore: false,
        }
    }),
}))

mock.module("../../../src/commander/bookmarks", () => ({
    fetchBookmarks: mock(async () => {
        fetchBookmarkCalls++
        return fetchBookmarkCalls === 1
            ? [mainBookmark, parentBookmark, childBookmark]
            : [mainBookmark, childBookmark]
    }),
}))

mock.module("../../../src/commander/github", () => ({
    ghListPullRequestsByHead: mock(
        async (
            heads: readonly string[],
        ): Promise<Map<string, GitHubPullRequestSummary>> => {
            expect(heads).toContain("test/stack")
            return new Map([
                [
                    "test/stack",
                    {
                        number: 114,
                        headRefName: "test/stack",
                        baseRefName: "main",
                        state: "MERGED",
                        merged: true,
                    },
                ],
                [
                    "test/stack-2",
                    {
                        number: 117,
                        headRefName: "test/stack-2",
                        baseRefName: "test/stack",
                        state: "OPEN",
                        merged: false,
                    },
                ],
            ])
        },
    ),
    ghPrClose: mock(async () => result("gh pr close")),
    ghPrCreate: mock(async () => ({ ...result("gh pr create"), prNumber: 1 })),
    ghPrEditBase: mock(async (prNumber: number, base: string) => {
        calls.push(`edit:${prNumber}:${base}`)
        return result("gh pr edit")
    }),
    ghPrViewWeb: mock(async () => result("gh pr view")),
    ghUpsertStackComment: mock(async () => result("gh api")),
}))

mock.module("../../../src/commander/operations", () => ({
    fetchOpLogId: mock(async () => "op"),
    jjGitFetch: mock(async () => result("jj git fetch")),
    jjGitPushBookmark: mock(async (name: string) => {
        calls.push(`push:${name}`)
        return result("jj git push")
    }),
    jjRebase: mock(async (name: string, destination: string) => {
        calls.push(`rebase:${name}:${destination}`)
        return result("jj rebase")
    }),
    jjRevsetHasMatches: mock(async () => false),
    jjAbandon: mock(async (revision: string) => {
        calls.push(`abandon:${revision}`)
        return result("jj abandon")
    }),
}))

mock.module("../../../src/stack/services/StackJournal", () => ({
    writeStackJournal: mock(async () => undefined),
}))

describe("stack executor", () => {
    test("sync preserves selected stack when fetch deleted the merged root bookmark", async () => {
        fetchLogCalls = 0
        fetchBookmarkCalls = 0

        const { prepareSyncPlan } = await import("../../../src/stack/executor")
        const plan = await Effect.runPromise(
            prepareSyncPlan({ stackRootName: "test/stack" }),
        )

        expect(fetchLogCalls).toBe(2)
        expect(plan.rows.map((row) => row.row.bookmark.name)).toEqual([
            "main",
            "test/stack",
            "test/stack-2",
        ])
        expect(plan.abandonBookmarks).toEqual(["test/stack"])
        expect(plan.rebaseBookmarks).toEqual(["test/stack-2"])
        expect(plan.pushBookmarks).toEqual(["test/stack-2"])
        expect(plan.updatePrNumbers).toEqual([117])
        expect(
            plan.effects.find((effect) => effect.type === "abandon")?.revision,
        ).toBe("main..parent-change")
    })

    test("apply skips empty plans", async () => {
        calls.length = 0
        const plan: StackPlan<Bookmark> = {
            kind: "sync",
            stackRootName: "test/stack",
            rows: [],
            effects: [],
            updatePrNumbers: [],
            createPrBookmarks: [],
            pushBookmarks: [],
            rebaseBookmarks: [],
            abandonBookmarks: [],
            closePrNumbers: [],
            applyCommand: "stack sync",
        }

        const { applyStackPlan } = await import("../../../src/stack/executor")
        await Effect.runPromise(applyStackPlan(plan))

        expect(calls).toEqual([])
    })

    test("sync apply abandons merged roots before rebasing and pushing descendants", async () => {
        calls.length = 0
        const plan: StackPlan<Bookmark> = {
            kind: "sync",
            stackRootName: "test/stack",
            rows: [],
            effects: [
                {
                    type: "rebase",
                    bookmark: "test/stack-2",
                    from: "test/stack",
                    to: "main",
                },
                { type: "push", bookmark: "test/stack-2" },
                {
                    type: "update-pr",
                    bookmark: "test/stack-2",
                    prNumber: 117,
                    from: "test/stack",
                    to: "main",
                },
                {
                    type: "abandon",
                    bookmark: "test/stack",
                    prNumber: 114,
                    revision: "parent-change",
                },
            ],
            updatePrNumbers: [117],
            createPrBookmarks: [],
            pushBookmarks: ["test/stack-2"],
            rebaseBookmarks: ["test/stack-2"],
            abandonBookmarks: ["test/stack"],
            closePrNumbers: [],
            applyCommand: "stack sync",
        }

        const { applyStackPlan } = await import("../../../src/stack/executor")
        await Effect.runPromise(applyStackPlan(plan))

        expect(calls).toEqual([
            "abandon:parent-change",
            "rebase:test/stack-2:main",
            "push:test/stack-2",
            "edit:117:main",
        ])
    })
})

function commit(
    commitId: string,
    parentCommitIds: readonly string[],
    immutable = false,
): Commit {
    return {
        changeId: `${commitId}-change`,
        commitId,
        parentCommitIds: [...parentCommitIds],
        description: commitId,
        author: "Test",
        authorEmail: "test@example.com",
        timestamp: "2026-01-01T00:00:00Z",
        lines: [],
        refLine: "",
        isWorkingCopy: false,
        immutable,
        empty: false,
        divergent: false,
        bookmarks: [],
        gitHead: false,
        workingCopies: [],
    }
}

function bookmark(name: string, commitId: string, changeId: string): Bookmark {
    return {
        name,
        nameDisplay: name,
        changeId,
        commitId,
        changeIdDisplay: changeId.slice(0, 8),
        commitIdDisplay: commitId.slice(0, 8),
        descriptionDisplay: name,
        description: name,
        isLocal: true,
    }
}

function result(command: string) {
    return { command, stdout: "", stderr: "", exitCode: 0, success: true }
}
