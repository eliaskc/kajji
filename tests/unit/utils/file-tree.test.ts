import { describe, expect, it } from "bun:test"
import type { FileChange } from "../../../src/commander/types"
import {
	buildFileTree,
	flattenFlat,
	flattenTree,
	getFilePaths,
} from "../../../src/utils/file-tree"

describe("buildFileTree", () => {
	it("builds tree from single file", () => {
		const files: FileChange[] = [{ path: "file.ts", status: "added" }]
		const tree = buildFileTree(files)

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

	it("sorts directories before files", () => {
		const files: FileChange[] = [
			{ path: "file.ts", status: "added" },
			{ path: "dir/inner.ts", status: "added" },
		]
		const tree = buildFileTree(files)

		expect(tree.children[0]?.name).toBe("dir")
		expect(tree.children[1]?.name).toBe("file.ts")
	})

	it("sorts alphabetically within category", () => {
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

describe("flattenTree", () => {
	it("flattens tree to list", () => {
		const files: FileChange[] = [
			{ path: "src/a.ts", status: "added" },
			{ path: "src/b.ts", status: "modified" },
		]
		const tree = buildFileTree(files)
		const flat = flattenTree(tree, new Set())

		expect(flat).toHaveLength(3)
		expect(flat[0]?.node.name).toBe("src")
		expect(flat[1]?.node.name).toBe("a.ts")
		expect(flat[2]?.node.name).toBe("b.ts")
	})

	it("respects collapsed paths", () => {
		const files: FileChange[] = [
			{ path: "src/a.ts", status: "added" },
			{ path: "src/b.ts", status: "modified" },
		]
		const tree = buildFileTree(files)
		const collapsed = new Set(["src"])
		const flat = flattenTree(tree, collapsed)

		expect(flat).toHaveLength(1)
		expect(flat[0]?.node.name).toBe("src")
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

		expect(srcUtils?.visualDepth).toBe(0)
		expect(file?.visualDepth).toBe(1)
		expect(root?.visualDepth).toBe(0)
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

		expect(flat.map((f) => f.node.path)).toEqual(["a/a.ts", "a/b.ts", "z.ts"])
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
