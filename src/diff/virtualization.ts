import type { FlattenedFile } from "./parser"
import type { FileId, HunkId } from "./identifiers"

export type DiffRowType =
	| "file-header"
	| "hunk-header"
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
	hunkHeader?: string
}

export function flattenToRows(files: FlattenedFile[]): DiffRow[] {
	const rows: DiffRow[] = []
	let rowIndex = 0

	for (const file of files) {
		rows.push({
			type: "file-header",
			content: file.name,
			fileId: file.fileId,
			hunkId: null,
			side: null,
			rowIndex: rowIndex++,
			fileName: file.name,
		})

		for (const hunk of file.hunks) {
			rows.push({
				type: "hunk-header",
				content: hunk.header,
				fileId: file.fileId,
				hunkId: hunk.hunkId,
				side: null,
				rowIndex: rowIndex++,
				fileName: file.name,
				hunkHeader: hunk.header,
			})

			for (const line of hunk.lines) {
				rows.push({
					type: line.type === "hunk-header" ? "hunk-header" : line.type,
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
		}
	}

	return rows
}

export interface ViewportState {
	scrollTop: number
	viewportHeight: number
	totalRows: number
}

const DEFAULT_OVERSCAN = 25

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
	return rows.findIndex((r) => r.hunkId === hunkId && r.type === "hunk-header")
}

export function findRowIndexByFileId(rows: DiffRow[], fileId: FileId): number {
	return rows.findIndex((r) => r.fileId === fileId && r.type === "file-header")
}
