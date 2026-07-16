import { describe, expect, it } from "bun:test"
import { basename } from "node:path"
import type { FileChange } from "../../../src/commander/types"
import { getRepoPath } from "../../../src/repo"
import {
    aggregateFileLineStats,
    buildFileTree,
    flattenFlat,
    flattenTree,
    getFilePaths,
    orderFilePaths,
    orderFilesByPath,
} from "../../../src/utils/file-tree"

const repoRootName = basename(getRepoPath()) || getRepoPath()

describe("file ordering", () => {
    const paths = ["z-root.ts", "src/z.ts", "a-root.ts", "src/a.ts"]

    it("uses full-path order when showing the tree", () => {
        expect(orderFilePaths(paths, true)).toEqual([
            "a-root.ts",
            "src/a.ts",
            "src/z.ts",
            "z-root.ts",
        ])
    })

    it("uses full-path order when showing a flat list", () => {
        expect(orderFilePaths(paths, false)).toEqual([
            "a-root.ts",
            "src/a.ts",
            "src/z.ts",
            "z-root.ts",
        ])
    })

    it("reorders file data with the paths", () => {
        const files = paths.map((path, index) => ({ path, index }))

        expect(
            orderFilesByPath(files, (file) => file.path, true).map(
                (file) => file.index,
            ),
        ).toEqual([2, 3, 1, 0])
    })
})

describe("buildFileTree", () => {
    it("builds tree from single file", () => {
        const files: FileChange[] = [{ path: "file.ts", status: "added" }]
        const tree = buildFileTree(files)

        expect(tree.name).toBe(repoRootName)
        expect(tree.children).toHaveLength(1)
        expect(tree.children[0]?.name).toBe("file.ts")
        expect(tree.children[0]?.isDirectory).toBe(false)
        expect(tree.children[0]?.status).toBe("added")
    })

    it("builds tree from nested file", () => {
        const files: FileChange[] = [
            { path: "src/utils/file.ts", status: "modified" },
        ]
        const tree = buildFileTree(files)

        expect(tree.children).toHaveLength(1)
        expect(tree.children[0]?.name).toBe("src/utils")
        expect(tree.children[0]?.isDirectory).toBe(true)
        expect(tree.children[0]?.children[0]?.name).toBe("file.ts")
    })

    it("compresses single-child directories", () => {
        const files: FileChange[] = [{ path: "a/b/c/file.ts", status: "added" }]
        const tree = buildFileTree(files)

        expect(tree.children).toHaveLength(1)
        expect(tree.children[0]?.name).toBe("a/b/c")
        expect(tree.children[0]?.children[0]?.name).toBe("file.ts")
    })

    it("does not compress directories with multiple children", () => {
        const files: FileChange[] = [
            { path: "src/a.ts", status: "added" },
            { path: "src/b.ts", status: "modified" },
        ]
        const tree = buildFileTree(files)

        expect(tree.children).toHaveLength(1)
        expect(tree.children[0]?.name).toBe("src")
        expect(tree.children[0]?.children).toHaveLength(2)
    })

    it("sorts files and directories together by name", () => {
        const files: FileChange[] = [
            { path: "a-file.ts", status: "added" },
            { path: "z-dir/inner.ts", status: "added" },
        ]
        const tree = buildFileTree(files)

        expect(tree.children[0]?.name).toBe("a-file.ts")
        expect(tree.children[1]?.name).toBe("z-dir")
    })

    it("sorts siblings alphabetically", () => {
        const files: FileChange[] = [
            { path: "z.ts", status: "added" },
            { path: "a.ts", status: "added" },
            { path: "m.ts", status: "added" },
        ]
        const tree = buildFileTree(files)

        expect(tree.children[0]?.name).toBe("a.ts")
        expect(tree.children[1]?.name).toBe("m.ts")
        expect(tree.children[2]?.name).toBe("z.ts")
    })

    it("handles empty input", () => {
        const tree = buildFileTree([])
        expect(tree.children).toHaveLength(0)
    })
})

describe("aggregateFileLineStats", () => {
    it("rolls file stats up through directories and the root", () => {
        const tree = buildFileTree([
            { path: "src/a.ts", status: "added" },
            { path: "src/nested/b.ts", status: "modified" },
            { path: "README.md", status: "modified" },
        ])
        const stats = aggregateFileLineStats(
            tree,
            new Map([
                ["src/a.ts", { additions: 3, deletions: 1 }],
                ["src/nested/b.ts", { additions: 2, deletions: 4 }],
                ["README.md", { additions: 1, deletions: 0 }],
            ]),
        )

        expect(stats.get("src")).toEqual({ additions: 5, deletions: 5 })
        expect(stats.get("src/nested")).toEqual({ additions: 2, deletions: 4 })
        expect(stats.get("")).toEqual({ additions: 6, deletions: 5 })
    })

    it("omits nodes without visible stats", () => {
        const tree = buildFileTree([{ path: "src/a.ts", status: "modified" }])

        expect(aggregateFileLineStats(tree, new Map())).toEqual(new Map())
        expect(
            aggregateFileLineStats(
                tree,
                new Map([["src/a.ts", { additions: 0, deletions: 0 }]]),
            ),
        ).toEqual(new Map())
    })
})

describe("flattenTree", () => {
    it("flattens tree to list", () => {
        const files: FileChange[] = [
            { path: "src/a.ts", status: "added" },
            { path: "src/b.ts", status: "modified" },
        ]
        const tree = buildFileTree(files)
        const flat = flattenTree(tree, new Set())

        expect(flat).toHaveLength(4)
        expect(flat[0]?.node.name).toBe(repoRootName)
        expect(flat[1]?.node.name).toBe("src")
        expect(flat[2]?.node.name).toBe("a.ts")
        expect(flat[3]?.node.name).toBe("b.ts")
    })

    it("respects collapsed paths", () => {
        const files: FileChange[] = [
            { path: "src/a.ts", status: "added" },
            { path: "src/b.ts", status: "modified" },
        ]
        const tree = buildFileTree(files)
        const collapsed = new Set(["src"])
        const flat = flattenTree(tree, collapsed)

        expect(flat).toHaveLength(2)
        expect(flat[0]?.node.name).toBe(repoRootName)
        expect(flat[1]?.node.name).toBe("src")
    })

    it("calculates correct visual depth", () => {
        const files: FileChange[] = [
            { path: "src/utils/file.ts", status: "added" },
            { path: "root.ts", status: "added" },
        ]
        const tree = buildFileTree(files)
        const flat = flattenTree(tree, new Set())

        const srcUtils = flat.find((f) => f.node.name === "src/utils")
        const file = flat.find((f) => f.node.name === "file.ts")
        const root = flat.find((f) => f.node.name === "root.ts")

        expect(srcUtils?.visualDepth).toBe(1)
        expect(file?.visualDepth).toBe(2)
        expect(root?.visualDepth).toBe(1)
    })
})

describe("flattenFlat", () => {
    it("returns only files, no directories", () => {
        const files: FileChange[] = [
            { path: "src/a.ts", status: "added" },
            { path: "src/b.ts", status: "modified" },
        ]
        const tree = buildFileTree(files)
        const flat = flattenFlat(tree)

        expect(flat).toHaveLength(2)
        expect(flat.every((f) => !f.node.isDirectory)).toBe(true)
    })

    it("all items have visualDepth 0", () => {
        const files: FileChange[] = [
            { path: "src/utils/deep/file.ts", status: "added" },
            { path: "root.ts", status: "added" },
        ]
        const tree = buildFileTree(files)
        const flat = flattenFlat(tree)

        expect(flat.every((f) => f.visualDepth === 0)).toBe(true)
    })

    it("sorts by full path", () => {
        const files: FileChange[] = [
            { path: "z.ts", status: "added" },
            { path: "a/b.ts", status: "added" },
            { path: "a/a.ts", status: "added" },
        ]
        const tree = buildFileTree(files)
        const flat = flattenFlat(tree)

        expect(flat.map((f) => f.node.path)).toEqual([
            "a/a.ts",
            "a/b.ts",
            "z.ts",
        ])
    })

    it("handles empty tree", () => {
        const tree = buildFileTree([])
        expect(flattenFlat(tree)).toEqual([])
    })
})

describe("getFilePaths", () => {
    it("returns file path for single file node", () => {
        const files: FileChange[] = [{ path: "file.ts", status: "added" }]
        const tree = buildFileTree(files)
        const fileNode = tree.children[0]
        if (!fileNode) throw new Error("Expected file node")

        expect(getFilePaths(fileNode)).toEqual(["file.ts"])
    })

    it("returns all file paths under directory", () => {
        const files: FileChange[] = [
            { path: "src/a.ts", status: "added" },
            { path: "src/b.ts", status: "modified" },
        ]
        const tree = buildFileTree(files)
        const srcNode = tree.children[0]
        if (!srcNode) throw new Error("Expected src node")

        expect(getFilePaths(srcNode)).toEqual(["src/a.ts", "src/b.ts"])
    })

    it("returns nested file paths under directory", () => {
        const files: FileChange[] = [
            { path: "src/utils/helper.ts", status: "added" },
            { path: "src/index.ts", status: "modified" },
        ]
        const tree = buildFileTree(files)
        const srcNode = tree.children[0]
        if (!srcNode) throw new Error("Expected src node")

        const paths = getFilePaths(srcNode)
        expect(paths).toContain("src/utils/helper.ts")
        expect(paths).toContain("src/index.ts")
        expect(paths).toHaveLength(2)
    })

    it("returns empty array for empty directory", () => {
        const tree = buildFileTree([])
        expect(getFilePaths(tree)).toEqual([])
    })
})
