import type { DiffFile, Hunk } from "../diff/parser"
import type {
	CommentAnchor,
	CommentAnchorHunk,
	CommentAnchorLine,
	RevisionComments,
} from "./types"

export interface HunkIndexEntry {
	id: string
	filePath: string
	oldStart: number
	oldCount: number
	newStart: number
	newCount: number
	contextLines: string[]
	file: DiffFile
	hunk: Hunk
}

interface LineCandidate {
	filePath: string
	lineNumber: number
	side: "new" | "old"
	contextLines: string[]
}

export function getContextLines(
	file: DiffFile,
	hunk: Hunk,
	maxLines = 5,
): string[] {
	const lines: string[] = []
	for (const content of hunk.hunkContent) {
		if (content.type !== "context") continue
		for (let i = 0; i < content.lines; i++) {
			if (lines.length >= maxLines) return lines
			const raw = file.additionLines[content.additionLineIndex + i] ?? ""
			lines.push(raw.trim())
		}
	}
	return lines
}

export function buildHunkAnchor(
	id: string,
	file: DiffFile,
	hunk: Hunk,
): CommentAnchorHunk {
	return {
		id,
		type: "hunk",
		filePath: file.name,
		lineRange: {
			oldStart: hunk.deletionStart,
			oldCount: hunk.deletionLines,
			newStart: hunk.additionStart,
			newCount: hunk.additionLines,
		},
		contextLines: getContextLines(file, hunk),
		comments: [],
	}
}

export function buildHunkIndex(files: DiffFile[]): HunkIndexEntry[] {
	let counter = 0
	const entries: HunkIndexEntry[] = []

	for (const file of files) {
		for (const hunk of file.hunks) {
			counter += 1
			entries.push({
				id: `h${counter}`,
				filePath: file.name,
				oldStart: hunk.deletionStart,
				oldCount: hunk.deletionLines,
				newStart: hunk.additionStart,
				newCount: hunk.additionLines,
				contextLines: getContextLines(file, hunk),
				file,
				hunk,
			})
		}
	}

	return entries
}

function buildLineContext(
	lines: Array<{ content: string }>,
	index: number,
	maxLines = 5,
): string[] {
	const start = Math.max(0, index - 2)
	const end = Math.min(lines.length, index + 3)
	const result: string[] = []
	for (let i = start; i < end; i += 1) {
		const text = lines[i]?.content.trim()
		if (text) {
			result.push(text)
		}
		if (result.length >= maxLines) break
	}
	return result
}

function buildLineCandidates(files: DiffFile[]): Map<string, LineCandidate[]> {
	const byFile = new Map<string, LineCandidate[]>()
	for (const file of files) {
		const candidates: LineCandidate[] = []
		for (const hunk of file.hunks) {
			let oldLine = hunk.deletionStart
			let newLine = hunk.additionStart
			const lines: Array<{
				type: "context" | "addition" | "deletion"
				content: string
				oldLineNumber?: number
				newLineNumber?: number
			}> = []

			for (const content of hunk.hunkContent) {
				if (content.type === "context") {
					for (let i = 0; i < content.lines; i++) {
						const raw = file.additionLines[content.additionLineIndex + i] ?? ""
						lines.push({
							type: "context",
							content: raw,
							oldLineNumber: oldLine,
							newLineNumber: newLine,
						})
						oldLine += 1
						newLine += 1
					}
					continue
				}

				for (let i = 0; i < content.deletions; i++) {
					const raw = file.deletionLines[content.deletionLineIndex + i] ?? ""
					lines.push({
						type: "deletion",
						content: raw,
						oldLineNumber: oldLine,
					})
					oldLine += 1
				}

				for (let i = 0; i < content.additions; i++) {
					const raw = file.additionLines[content.additionLineIndex + i] ?? ""
					lines.push({
						type: "addition",
						content: raw,
						newLineNumber: newLine,
					})
					newLine += 1
				}
			}

			for (let index = 0; index < lines.length; index += 1) {
				const entry = lines[index]
				if (!entry) continue
				const contextLines = buildLineContext(lines, index)
				if (entry.type === "context") {
					if (entry.newLineNumber) {
						candidates.push({
							filePath: file.name,
							lineNumber: entry.newLineNumber,
							side: "new",
							contextLines,
						})
					}
					if (entry.oldLineNumber) {
						candidates.push({
							filePath: file.name,
							lineNumber: entry.oldLineNumber,
							side: "old",
							contextLines,
						})
					}
				} else if (entry.type === "addition" && entry.newLineNumber) {
					candidates.push({
						filePath: file.name,
						lineNumber: entry.newLineNumber,
						side: "new",
						contextLines,
					})
				} else if (entry.type === "deletion" && entry.oldLineNumber) {
					candidates.push({
						filePath: file.name,
						lineNumber: entry.oldLineNumber,
						side: "old",
						contextLines,
					})
				}
			}
		}
		if (candidates.length > 0) {
			byFile.set(file.name, candidates)
		}
	}
	return byFile
}

function overlapScore(a: string[], b: string[]): number {
	if (a.length === 0 || b.length === 0) return 0
	const aSet = new Set(a)
	let overlap = 0
	for (const line of b) {
		if (aSet.has(line)) overlap += 1
	}
	return overlap / Math.max(a.length, b.length)
}

function lineScore(
	anchor: CommentAnchorHunk,
	candidate: HunkIndexEntry,
): number {
	const anchorStart =
		anchor.lineRange.newCount > 0
			? anchor.lineRange.newStart
			: anchor.lineRange.oldStart
	const candidateStart =
		candidate.newCount > 0 ? candidate.newStart : candidate.oldStart
	const delta = Math.abs(anchorStart - candidateStart)
	return 1 - Math.min(delta / 50, 1)
}

function matchScore(
	anchor: CommentAnchorHunk,
	candidate: HunkIndexEntry,
): number {
	if (anchor.contextLines.length === 0 || candidate.contextLines.length === 0) {
		return lineScore(anchor, candidate)
	}
	const context = overlapScore(anchor.contextLines, candidate.contextLines)
	const lines = lineScore(anchor, candidate)
	return context * 0.7 + lines * 0.3
}

function lineProximityScore(anchorLine: number, candidateLine: number): number {
	const delta = Math.abs(anchorLine - candidateLine)
	return 1 - Math.min(delta / 50, 1)
}

function matchLineScore(
	anchor: CommentAnchorLine,
	candidate: LineCandidate,
): number {
	if (anchor.contextLines.length === 0 || candidate.contextLines.length === 0) {
		return lineProximityScore(anchor.lineNumber, candidate.lineNumber)
	}
	const context = overlapScore(anchor.contextLines, candidate.contextLines)
	const lines = lineProximityScore(anchor.lineNumber, candidate.lineNumber)
	return context * 0.7 + lines * 0.3
}

export function relocateRevision(
	revision: RevisionComments,
	files: DiffFile[],
): { updated: RevisionComments; changed: boolean } {
	const entries = buildHunkIndex(files)
	const byFile = new Map<string, HunkIndexEntry[]>()
	for (const entry of entries) {
		const list = byFile.get(entry.filePath)
		if (list) {
			list.push(entry)
		} else {
			byFile.set(entry.filePath, [entry])
		}
	}
	const lineCandidatesByFile = buildLineCandidates(files)

	const usedHunks = new Set<string>()
	const usedLines = new Set<string>()
	const nextAnchors: CommentAnchor[] = []
	let changed = false

	for (const anchor of revision.anchors) {
		if (anchor.type === "hunk") {
			const candidates = byFile.get(anchor.filePath) ?? []
			let best: HunkIndexEntry | null = null
			let bestScore = -1

			for (const candidate of candidates) {
				if (usedHunks.has(candidate.id)) continue
				const score = matchScore(anchor, candidate)
				if (score > bestScore) {
					bestScore = score
					best = candidate
				}
			}

			if (best && bestScore >= 0.4) {
				usedHunks.add(best.id)
				const updatedAnchor: CommentAnchorHunk = {
					id: best.id,
					type: "hunk",
					filePath: best.filePath,
					lineRange: {
						oldStart: best.oldStart,
						oldCount: best.oldCount,
						newStart: best.newStart,
						newCount: best.newCount,
					},
					contextLines: best.contextLines,
					comments: anchor.comments,
					stale: false,
				}

				nextAnchors.push(updatedAnchor)

				if (best.id !== anchor.id || anchor.stale) {
					changed = true
				}
				continue
			}

			nextAnchors.push({
				...anchor,
				stale: true,
			})
			if (!anchor.stale) {
				changed = true
			}
			continue
		}

		const candidates = lineCandidatesByFile.get(anchor.filePath)
		if (!candidates || candidates.length === 0) {
			nextAnchors.push(anchor)
			continue
		}

		const allowSide = anchor.side ?? "new"
		let best: LineCandidate | null = null
		let bestScore = -1
		for (const candidate of candidates) {
			if (candidate.side !== allowSide) continue
			const key = `${candidate.filePath}:${candidate.side}:${candidate.lineNumber}`
			if (usedLines.has(key)) continue
			const score = matchLineScore(anchor, candidate)
			if (score > bestScore) {
				bestScore = score
				best = candidate
			}
		}

		if (best && bestScore >= 0.4) {
			const key = `${best.filePath}:${best.side}:${best.lineNumber}`
			usedLines.add(key)
			const updatedAnchor: CommentAnchorLine = {
				...anchor,
				filePath: best.filePath,
				lineNumber: best.lineNumber,
				contextLines: best.contextLines,
				stale: false,
			}
			nextAnchors.push(updatedAnchor)
			if (
				updatedAnchor.lineNumber !== anchor.lineNumber ||
				anchor.stale ||
				updatedAnchor.contextLines.join("\n") !== anchor.contextLines.join("\n")
			) {
				changed = true
			}
			continue
		}

		nextAnchors.push({
			...anchor,
			stale: true,
		})
		if (!anchor.stale) {
			changed = true
		}
	}

	return {
		updated: {
			...revision,
			anchors: nextAnchors,
		},
		changed,
	}
}
