import {
	type ChangeContent,
	type ContextContent,
	type FileDiffMetadata,
	type Hunk,
	type ParsedPatch,
	parsePatchFiles,
} from "@pierre/diffs"
import { execute } from "../commander/executor"
import { type FileId, type HunkId, fileId, hunkId } from "./identifiers"

// Re-export types for convenience
export type {
	ChangeContent,
	ContextContent,
	FileDiffMetadata,
	Hunk,
	ParsedPatch,
}

export interface ParseDiffOptions {
	cwd?: string
	/** Specific file paths to include in the diff */
	paths?: string[]
}

/**
 * Fetch and parse a diff from jj into structured format.
 * Uses --git format for proper parsing (no ANSI colors).
 */
export async function fetchParsedDiff(
	changeId: string,
	options: ParseDiffOptions = {},
): Promise<FileDiffMetadata[]> {
	const args = ["diff", "-r", changeId, "--git", "--ignore-working-copy"]

	// Add specific file paths if provided
	if (options.paths && options.paths.length > 0) {
		args.push(...options.paths)
	}

	const result = await execute(args, { cwd: options.cwd })

	if (!result.success) {
		throw new Error(`jj diff failed: ${result.stderr}`)
	}

	return parseDiffString(result.stdout)
}

/**
 * Parse a git-format diff string into structured format.
 */
export function parseDiffString(diffString: string): FileDiffMetadata[] {
	if (!diffString.trim()) {
		return []
	}

	const patches = parsePatchFiles(diffString)

	// parsePatchFiles returns an array of ParsedPatch (one per commit in multi-commit diffs)
	// For jj single-revision diffs, we typically get one patch
	return patches.flatMap((patch) => patch.files)
}

/**
 * Diff line type for rendering.
 */
export type DiffLineType = "context" | "addition" | "deletion"

/**
 * A single line in a diff, flattened for rendering.
 */
export interface DiffLine {
	type: DiffLineType
	content: string
	// Line numbers (undefined for additions on old side, deletions on new side)
	oldLineNumber?: number
	newLineNumber?: number
	// Parent hunk for navigation
	hunkId: HunkId
}

/**
 * A flattened hunk ready for rendering.
 */
export interface FlattenedHunk {
	hunkId: HunkId
	context?: string // function name, etc.
	lines: DiffLine[]
	oldStart: number
	oldLines: number
	newStart: number
	newLines: number
}

/**
 * A flattened file ready for rendering.
 */
export interface FlattenedFile {
	fileId: FileId
	name: string
	prevName?: string
	type: FileDiffMetadata["type"]
	hunks: FlattenedHunk[]
	additions: number
	deletions: number
}

/**
 * Flatten a hunk into individual lines for rendering.
 */
export function flattenHunk(file: FileDiffMetadata, hunk: Hunk): FlattenedHunk {
	const id = hunkId(file, hunk)
	const lines: DiffLine[] = []
	let oldLine = hunk.deletionStart
	let newLine = hunk.additionStart

	for (const content of hunk.hunkContent) {
		if (content.type === "context") {
			const ctx = content as ContextContent
			for (const line of ctx.lines) {
				lines.push({
					type: "context",
					content: line,
					oldLineNumber: oldLine++,
					newLineNumber: newLine++,
					hunkId: id,
				})
			}
		} else if (content.type === "change") {
			const change = content as ChangeContent

			// Deletions first (old side)
			for (const line of change.deletions) {
				lines.push({
					type: "deletion",
					content: line,
					oldLineNumber: oldLine++,
					hunkId: id,
				})
			}

			// Then additions (new side)
			for (const line of change.additions) {
				lines.push({
					type: "addition",
					content: line,
					newLineNumber: newLine++,
					hunkId: id,
				})
			}
		}
	}

	return {
		hunkId: id,
		context: hunk.hunkContext,
		lines,
		oldStart: hunk.deletionStart,
		oldLines: hunk.deletionLines,
		newStart: hunk.additionStart,
		newLines: hunk.additionLines,
	}
}

/**
 * Flatten a file diff for rendering.
 */
export function flattenFile(file: FileDiffMetadata): FlattenedFile {
	let additions = 0
	let deletions = 0

	const hunks = file.hunks.map((hunk) => {
		additions += hunk.additionCount
		deletions += hunk.deletionCount
		return flattenHunk(file, hunk)
	})

	return {
		fileId: fileId(file),
		name: file.name,
		prevName: file.prevName,
		type: file.type,
		hunks,
		additions,
		deletions,
	}
}

/**
 * Flatten all files for rendering.
 */
export function flattenDiff(files: FileDiffMetadata[]): FlattenedFile[] {
	return files.map(flattenFile)
}

/**
 * Get file status indicator for display.
 */
export function getFileStatusIndicator(type: FileDiffMetadata["type"]): string {
	switch (type) {
		case "new":
			return "A"
		case "deleted":
			return "D"
		case "rename-pure":
		case "rename-changed":
			return "R"
		default:
			return "M"
	}
}

/**
 * Get total counts across all files.
 */
export function getDiffTotals(files: FileDiffMetadata[]): {
	files: number
	additions: number
	deletions: number
} {
	let additions = 0
	let deletions = 0

	for (const file of files) {
		for (const hunk of file.hunks) {
			additions += hunk.additionCount
			deletions += hunk.deletionCount
		}
	}

	return { files: files.length, additions, deletions }
}

/**
 * Get the maximum line number across all flattened files.
 * Used for consistent gutter width alignment.
 */
export function getMaxLineNumber(files: FlattenedFile[]): number {
	let max = 0
	for (const file of files) {
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				if (line.oldLineNumber && line.oldLineNumber > max) {
					max = line.oldLineNumber
				}
				if (line.newLineNumber && line.newLineNumber > max) {
					max = line.newLineNumber
				}
			}
		}
	}
	return max
}

/**
 * Calculate the width needed to display a line number.
 */
export function getLineNumWidth(maxLineNum: number): number {
	if (maxLineNum <= 0) return 1
	return Math.max(1, Math.floor(Math.log10(maxLineNum)) + 1)
}
