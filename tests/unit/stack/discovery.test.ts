import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { buildBookmarkStackModel } from "../../../src/stack/discovery"

const commits = [
    { commitId: "main", parentCommitIds: [], immutable: true },
    { commitId: "a", parentCommitIds: ["main"], immutable: false },
    { commitId: "b", parentCommitIds: ["a"], immutable: false },
    { commitId: "c", parentCommitIds: ["b"], immutable: false },
    { commitId: "solo", parentCommitIds: ["main"], immutable: false },
]

const bookmarks = [
    { name: "main", commitId: "main", changeId: "main" },
    { name: "feature-a", commitId: "a", changeId: "a" },
    { name: "feature-b", commitId: "b", changeId: "b" },
    { name: "feature-c", commitId: "c", changeId: "c" },
    { name: "standalone", commitId: "solo", changeId: "solo" },
]

describe("buildBookmarkStackModel", () => {
    test("renders only actual multi-bookmark stacks under trunk", async () => {
        const model = await Effect.runPromise(
            buildBookmarkStackModel({ commits, bookmarks }),
        )

        expect(model.rows.map((row) => [row.bookmark.name, row.depth])).toEqual(
            [
                ["main", 0],
                ["feature-a", 1],
                ["feature-b", 2],
                ["feature-c", 3],
                ["standalone", 0],
            ],
        )
        expect(model.parentByName.get("feature-a")).toBe("main")
        expect(model.parentByName.get("feature-b")).toBe("feature-a")
        expect(model.parentByName.get("feature-c")).toBe("feature-b")
        expect(model.parentByName.has("standalone")).toBe(false)
    })

    test("marks all stack members with the stack root key for highlighting", async () => {
        const model = await Effect.runPromise(
            buildBookmarkStackModel({ commits, bookmarks }),
        )
        const stackKeysByName = new Map(
            model.rows.map((row) => [row.bookmark.name, row.stackKeys]),
        )

        expect(stackKeysByName.get("main")).toEqual(["feature-a"])
        expect(stackKeysByName.get("feature-a")).toEqual(["feature-a"])
        expect(stackKeysByName.get("feature-b")).toEqual(["feature-a"])
        expect(stackKeysByName.get("feature-c")).toEqual(["feature-a"])
        expect(stackKeysByName.get("standalone")).toEqual([])
    })

    test("does not stack when every bookmark targets trunk", async () => {
        const model = await Effect.runPromise(
            buildBookmarkStackModel({
                commits,
                bookmarks: [
                    { name: "main", commitId: "main", changeId: "main" },
                    { name: "one", commitId: "a", changeId: "a" },
                    { name: "two", commitId: "solo", changeId: "solo" },
                ],
            }),
        )

        expect(model.rows.map((row) => [row.bookmark.name, row.depth])).toEqual(
            [
                ["main", 0],
                ["one", 0],
                ["two", 0],
            ],
        )
    })
})
