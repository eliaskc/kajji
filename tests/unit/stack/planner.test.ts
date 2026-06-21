import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { buildBookmarkStackModel } from "../../../src/stack/discovery"
import { buildSyncPlanSync } from "../../../src/stack/planner"

const commits = [
    { commitId: "main", parentCommitIds: [], immutable: true },
    { commitId: "a", parentCommitIds: ["main"], immutable: false },
    { commitId: "b", parentCommitIds: ["a"], immutable: false },
]

const threeBookmarkCommits = [
    ...commits,
    { commitId: "c", parentCommitIds: ["b"], immutable: false },
]

const bookmarks = [
    { name: "main", commitId: "main", changeId: "main" },
    { name: "feature-a", commitId: "a", changeId: "a" },
    { name: "feature-b", commitId: "b", changeId: "b" },
]

const threeBookmarks = [
    ...bookmarks,
    { name: "feature-c", commitId: "c", changeId: "c" },
]

const model = async () =>
    Effect.runPromise(buildBookmarkStackModel({ commits, bookmarks }))

const threeBookmarkModel = async () =>
    Effect.runPromise(
        buildBookmarkStackModel({
            commits: threeBookmarkCommits,
            bookmarks: threeBookmarks,
        }),
    )

describe("stack planners", () => {
    test("sync plans PR creation, retargeting and pushes", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-a",
                    {
                        number: 10,
                        headRefName: "feature-a",
                        baseRefName: "old",
                    },
                ],
            ]),
            remoteBookmarksByName: new Map([
                ["feature-a", { name: "feature-a", commitId: "old-a" }],
            ]),
        })

        expect(
            plan.rows.map((row) => [row.row.bookmark.name, row.note]),
        ).toEqual([
            ["main", ""],
            ["feature-a", "would push and retarget PR onto main"],
            ["feature-b", "would push and create PR onto feature-a"],
        ])
        expect(plan.updatePrNumbers).toEqual([10])
        expect(plan.createPrBookmarks).toEqual(["feature-b"])
        expect(plan.pushBookmarks).toEqual(["feature-a", "feature-b"])
    })

    test("sync plans closed-unmerged parent effects before apply", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-a",
                    {
                        number: 10,
                        headRefName: "feature-a",
                        baseRefName: "main",
                        state: "CLOSED",
                        merged: false,
                    },
                ],
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "feature-a",
                        state: "OPEN",
                    },
                ],
            ]),
        })

        expect(
            plan.rows.map((row) => [row.row.bookmark.name, row.status]),
        ).toEqual([
            ["main", "current"],
            ["feature-a", "blocked"],
            ["feature-b", "close-pr"],
        ])
        expect(plan.rows[2]?.note).toBe(
            "would close PR: parent #10 was closed without merging",
        )
        expect(plan.closePrNumbers).toEqual([11])
    })

    test("sync plans descendant PR closure even if GitHub state is missing", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-a",
                    {
                        number: 10,
                        headRefName: "feature-a",
                        baseRefName: "main",
                        state: "CLOSED",
                        merged: false,
                    },
                ],
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "feature-a",
                    },
                ],
            ]),
        })

        expect(plan.rows[2]?.status).toBe("close-pr")
        expect(plan.closePrNumbers).toEqual([11])
    })

    test("sync plans rebase and retarget descendants of merged parents", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-a",
                    {
                        number: 10,
                        headRefName: "feature-a",
                        baseRefName: "main",
                        state: "MERGED",
                        merged: true,
                    },
                ],
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "feature-a",
                        state: "OPEN",
                    },
                ],
            ]),
        })

        expect(plan.rows[1]?.note).toBe("would abandon merged local change")
        expect(plan.rows[2]?.note).toBe(
            "would rebase, push, and retarget onto main",
        )
        expect(plan.abandonBookmarks).toEqual(["feature-a"])
        expect(plan.rebaseBookmarks).toEqual(["feature-b"])
        expect(plan.pushBookmarks).toEqual(["feature-b"])
        expect(plan.updatePrNumbers).toEqual([11])
        expect(
            plan.effects.find((effect) => effect.type === "abandon")?.revision,
        ).toBe("main..a")
    })

    test("sync pushes descendants after a branch rebase", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await threeBookmarkModel(),
            pullRequestsByHead: new Map([
                [
                    "feature-a",
                    {
                        number: 10,
                        headRefName: "feature-a",
                        baseRefName: "main",
                        state: "MERGED",
                        merged: true,
                    },
                ],
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "feature-a",
                        state: "OPEN",
                    },
                ],
                [
                    "feature-c",
                    {
                        number: 12,
                        headRefName: "feature-c",
                        baseRefName: "feature-b",
                        state: "OPEN",
                    },
                ],
            ]),
            remoteBookmarksByName: new Map([
                ["feature-a", { name: "feature-a", commitId: "a" }],
                ["feature-b", { name: "feature-b", commitId: "b" }],
                ["feature-c", { name: "feature-c", commitId: "c" }],
            ]),
        })

        expect(plan.rows[2]?.effects.map((effect) => effect.type)).toEqual([
            "rebase",
            "push",
            "update-pr",
        ])
        expect(plan.rows[3]?.effects.map((effect) => effect.type)).toEqual([
            "push",
        ])
    })

    test("sync keeps a merged local bookmark while remote bookmark still exists", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-a",
                    {
                        number: 10,
                        headRefName: "feature-a",
                        baseRefName: "main",
                        state: "MERGED",
                        merged: true,
                    },
                ],
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "feature-a",
                        state: "OPEN",
                    },
                ],
            ]),
            remoteBookmarksByName: new Map([
                ["feature-a", { name: "feature-a", commitId: "a" }],
                ["feature-b", { name: "feature-b", commitId: "b" }],
            ]),
        })

        expect(plan.rows[1]?.effects.map((effect) => effect.type)).toEqual([])
        expect(plan.rows[2]?.effects.map((effect) => effect.type)).toEqual([
            "rebase",
            "push",
            "update-pr",
        ])
        expect(plan.abandonBookmarks).toEqual([])
    })

    test("sync does not update stack comments when stack contains merged PRs", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-a",
                    {
                        number: 10,
                        headRefName: "feature-a",
                        baseRefName: "main",
                        state: "MERGED",
                        merged: true,
                    },
                ],
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "feature-a",
                        state: "OPEN",
                    },
                ],
            ]),
            remoteBookmarksByName: new Map([
                ["feature-a", { name: "feature-a", commitId: "a" }],
                ["feature-b", { name: "feature-b", commitId: "b" }],
            ]),
        })

        expect(
            plan.effects.some((effect) => effect.type === "update-comment"),
        ).toBe(false)
    })

    test("sync does not also plan landed range repair for an already-merged PR", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "main",
                        state: "MERGED",
                        merged: true,
                    },
                ],
            ]),
            landedRangesByBookmark: new Map([
                ["feature-b", "(main..a) & ancestors(b) ~ ancestors(main)"],
            ]),
        })

        expect(plan.rows[2]?.effects.map((effect) => effect.type)).toEqual([
            "abandon",
        ])
    })

    test("sync does not plan child landed range when parent is being abandoned", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-a",
                    {
                        number: 10,
                        headRefName: "feature-a",
                        baseRefName: "main",
                        state: "MERGED",
                        merged: true,
                    },
                ],
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "main",
                        state: "OPEN",
                    },
                ],
            ]),
            landedRangesByBookmark: new Map([
                ["feature-b", "(main..a) & ancestors(b) ~ ancestors(main)"],
            ]),
        })

        expect(plan.rows[2]?.effects.map((effect) => effect.type)).toEqual([
            "rebase",
            "push",
        ])
    })

    test("sync plans landed parent range repair from persisted state", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "main",
                        state: "OPEN",
                    },
                ],
            ]),
            landedRangesByBookmark: new Map([
                ["feature-b", "(main..a) & ancestors(b) ~ ancestors(main)"],
            ]),
        })

        expect(plan.rows[2]?.status).toBe("abandon-landed-range")
        expect(plan.rows[2]?.note).toBe("would abandon landed parent range")
        expect(plan.abandonBookmarks).toEqual(["feature-b"])
    })

    test("sync plans PR retargets when GitHub PR base differs from local target", async () => {
        const plan = buildSyncPlanSync({
            stackRootName: "feature-a",
            stackModel: await model(),
            pullRequestsByHead: new Map([
                [
                    "feature-b",
                    {
                        number: 11,
                        headRefName: "feature-b",
                        baseRefName: "main",
                    },
                ],
            ]),
        })

        expect(
            plan.rows.map((row) => [row.row.bookmark.name, row.note]),
        ).toEqual([
            ["main", ""],
            ["feature-a", "would push and create PR onto main"],
            ["feature-b", "would push and retarget PR onto feature-a"],
        ])
        expect(plan.updatePrNumbers).toEqual([11])
    })
})
