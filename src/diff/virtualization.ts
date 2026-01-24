import type { FileId, HunkId } from "./identifiers"
import type { FlattenedFile } from "./parser"

export type DiffRowType =
	| "file-header"
	| "file-gap"
	| "gap"
	| "context"
	| "addition"
	| "deletion"

export interface DiffRow {
	type: DiffRowType
	content: string
	fileId: FileId
	hunkId: HunkId | null
	oldLineNumber?: number
	newLineNumber?: number
	side: "LEFT" | "RIGHT" | null
	rowIndex: number
	fileName: string
	gapLines?: number
}

export function flattenToRows(files: FlattenedFile[]): DiffRow[] {
	const rows: DiffRow[] = []
	let rowIndex = 0

	for (const [fileIndex, file] of files.entries()) {
		rows.push({
			type: "file-header",
			content: file.name,
			fileId: file.fileId,
			hunkId: null,
			side: null,
			rowIndex: rowIndex++,
			fileName: file.name,
		})

		let prevHunk = null as FlattenedFile["hunks"][number] | null
		for (const hunk of file.hunks) {
			if (!prevHunk) {
				const gapOld = hunk.oldStart - 1
				const gapNew = hunk.newStart - 1
				const gapLines = Math.max(gapOld, gapNew)
				if (gapLines > 0) {
					rows.push({
						type: "gap",
						content: "",
						fileId: file.fileId,
						hunkId: null,
						side: null,
						rowIndex: rowIndex++,
						fileName: file.name,
						gapLines,
					})
				}
			} else {
				const prevOldEnd = prevHunk.oldStart + prevHunk.oldLines
				const prevNewEnd = prevHunk.newStart + prevHunk.newLines
				const gapOld = hunk.oldStart - prevOldEnd
				const gapNew = hunk.newStart - prevNewEnd
				const gapLines = Math.max(gapOld, gapNew)
				if (gapLines > 0) {
					rows.push({
						type: "gap",
						content: "",
						fileId: file.fileId,
						hunkId: null,
						side: null,
						rowIndex: rowIndex++,
						fileName: file.name,
						gapLines,
					})
				}
			}

			for (const line of hunk.lines) {
				rows.push({
					type: line.type,
					content: line.content,
					fileId: file.fileId,
					hunkId: hunk.hunkId,
					oldLineNumber: line.oldLineNumber,
					newLineNumber: line.newLineNumber,
					side:
						line.type === "deletion"
							? "LEFT"
							: line.type === "addition"
								? "RIGHT"
								: null,
					rowIndex: rowIndex++,
					fileName: file.name,
				})
			}

			prevHunk = hunk
		}

		if (fileIndex < files.length - 1) {
			rows.push({
				type: "file-gap",
				content: "",
				fileId: file.fileId,
				hunkId: null,
				side: null,
				rowIndex: rowIndex++,
				fileName: file.name,
			})
		}
	}

	return rows
}

export interface ViewportState {
	scrollTop: number
	viewportHeight: number
	totalRows: number
}

const DEFAULT_OVERSCAN = 50

export function getVisibleRange(
	viewport: ViewportState,
	overscan = DEFAULT_OVERSCAN,
): { start: number; end: number } {
	const start = Math.max(0, Math.floor(viewport.scrollTop) - overscan)
	const end = Math.min(
		viewport.totalRows,
		Math.ceil(viewport.scrollTop + viewport.viewportHeight) + overscan,
	)
	return { start, end }
}

export function findRowIndexByHunkId(rows: DiffRow[], hunkId: HunkId): number {
	return rows.findIndex(
		(r) =>
			r.hunkId === hunkId &&
			r.type !== "file-header" &&
			r.type !== "gap" &&
			r.type !== "file-gap",
	)
}

export function findRowIndexByFileId(rows: DiffRow[], fileId: FileId): number {
	return rows.findIndex((r) => r.fileId === fileId && r.type === "file-header")
}
