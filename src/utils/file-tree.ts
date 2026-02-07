import type { FileChange, FileStatus } from "../commander/types"

export interface FileTreeNode {
	name: string
	path: string
	isDirectory: boolean
	status?: FileStatus
	isBinary?: boolean
	children: FileTreeNode[]
	depth: number
}

export interface FlatFileNode {
	node: FileTreeNode
	visualDepth: number
}

function splitPath(path: string): string[] {
	return path.split("/").filter((part) => part.length > 0)
}

function insertIntoTree(
	root: FileTreeNode,
	file: FileChange,
	parts: string[],
	depth: number,
): void {
	if (parts.length === 0) return

	const [current, ...rest] = parts
	if (!current) return

	let child = root.children.find((c) => c.name === current)

	if (!child) {
		const isFile = rest.length === 0
		const path = root.path ? `${root.path}/${current}` : current

		child = {
			name: current,
			path,
			isDirectory: !isFile,
			status: isFile ? file.status : undefined,
			isBinary: isFile ? file.isBinary : undefined,
			children: [],
			depth: depth,
		}
		root.children.push(child)
	}

	if (rest.length > 0) {
		insertIntoTree(child, file, rest, depth + 1)
	}
}

function sortTree(node: FileTreeNode): void {
	node.children.sort((a, b) => {
		if (a.isDirectory && !b.isDirectory) return -1
		if (!a.isDirectory && b.isDirectory) return 1
		return a.name.localeCompare(b.name)
	})
	for (const child of node.children) {
		sortTree(child)
	}
}

function compressNode(node: FileTreeNode): void {
	while (
		node.isDirectory &&
		node.children.length === 1 &&
		node.children[0]?.isDirectory
	) {
		const onlyChild = node.children[0]
		node.name = node.name ? `${node.name}/${onlyChild.name}` : onlyChild.name
		node.path = onlyChild.path
		node.children = onlyChild.children
	}
}

function compressTree(root: FileTreeNode): void {
	for (const child of root.children) {
		compressTreeRecursive(child)
	}
}

function compressTreeRecursive(node: FileTreeNode): void {
	for (const child of node.children) {
		compressTreeRecursive(child)
	}
	compressNode(node)
}

export function buildFileTree(files: FileChange[]): FileTreeNode {
	const root: FileTreeNode = {
		name: "",
		path: "",
		isDirectory: true,
		children: [],
		depth: 0,
	}

	for (const file of files) {
		const parts = splitPath(file.path)
		insertIntoTree(root, file, parts, 1)
	}

	sortTree(root)
	compressTree(root)

	return root
}

export function flattenTree(
	root: FileTreeNode,
	collapsedPaths: Set<string>,
): FlatFileNode[] {
	const result: FlatFileNode[] = []

	function traverse(node: FileTreeNode, visualDepth: number): void {
		if (node.path) {
			result.push({ node, visualDepth })
		}

		if (node.isDirectory && !collapsedPaths.has(node.path)) {
			for (const child of node.children) {
				traverse(child, node.path ? visualDepth + 1 : visualDepth)
			}
		}
	}

	traverse(root, 0)
	return result
}

export function flattenFlat(root: FileTreeNode): FlatFileNode[] {
	const result: FlatFileNode[] = []

	function collect(node: FileTreeNode): void {
		if (!node.isDirectory) {
			result.push({ node, visualDepth: 0 })
		}
		for (const child of node.children) {
			collect(child)
		}
	}

	collect(root)
	result.sort((a, b) => a.node.path.localeCompare(b.node.path))
	return result
}

export function countVisibleNodes(
	root: FileTreeNode,
	collapsedPaths: Set<string>,
): number {
	return flattenTree(root, collapsedPaths).length
}

export function getFilePaths(node: FileTreeNode): string[] {
	const paths: string[] = []

	function collect(n: FileTreeNode): void {
		if (!n.isDirectory) {
			paths.push(n.path)
		}
		for (const child of n.children) {
			collect(child)
		}
	}

	collect(node)
	return paths
}
