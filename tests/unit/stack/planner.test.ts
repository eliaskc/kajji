import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { buildBookmarkStackModel } from "../../../src/stack/discovery"
import {
    buildSubmitPlanSync,
    buildSyncPlanSync,
} from "../../../src/stack/planner"

const commits = [
    { commitId: "main", parentCommitIds: [], immutable: true },
    { commitId: "a", parentCommitIds: ["main"], immutable: false },
    { commitId: "b", parentCommitIds: ["a"], immutable: false },
]

const bookmarks = [
    { name: "main", commitId: "main", changeId: "main" },
    { name: "feature-a", commitId: "a", changeId: "a" },
    { name: "feature-b", commitId: "b", changeId: "b" },
]

const model = async () =>
    Effect.runPromise(buildBookmarkStackModel({ commits, bookmarks }))

describe("stack planners", () => {
    test("submit plans PR creation, retargeting and pushes", async () => {
        const plan = buildSubmitPlanSync({
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
            ["feature-a", "would retarget PR onto main"],
            ["feature-b", "would create PR onto feature-a"],
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
        expect(plan.closePrNumbers).toEqual([11])
    })

    test("sync plans rebases when GitHub PR base differs from local target", async () => {
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
            ["feature-a", "targets main"],
            ["feature-b", "would rebase onto main"],
        ])
        expect(plan.rebaseBookmarks).toEqual(["feature-b"])
    })
})
