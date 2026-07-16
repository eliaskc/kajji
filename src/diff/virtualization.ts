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

export interface DiffPosition {
    fileId: FileId
    lineNumber?: number
}

export function getCurrentDiffPosition<Row extends { row: { fileId: FileId } }>(
    rows: readonly Row[],
    scrollTop: number,
    getNewLineNumber: (row: Row) => number | undefined,
    getOldLineNumber: (row: Row) => number | undefined,
    focusRow = scrollTop,
): DiffPosition | null {
    if (rows.length === 0) return null
    const index = Math.min(rows.length - 1, Math.max(0, Math.floor(scrollTop)))
    const focusIndex = Math.min(
        rows.length - 1,
        Math.max(0, Math.floor(focusRow)),
    )
    const current = rows[index]
    if (!current) return null

    const fileId = current.row.fileId
    const findNearestLine = (
        getLineNumber: (row: Row) => number | undefined,
    ): number | undefined => {
        for (let distance = 0; distance < rows.length; distance++) {
            const after = rows[focusIndex + distance]
            if (after?.row.fileId === fileId) {
                const line = getLineNumber(after)
                if (line !== undefined) return line
            }

            if (distance === 0) continue
            const before = rows[focusIndex - distance]
            if (before?.row.fileId === fileId) {
                const line = getLineNumber(before)
                if (line !== undefined) return line
            }
        }
        return undefined
    }

    return {
        fileId,
        lineNumber:
            findNearestLine(getNewLineNumber) ??
            findNearestLine(getOldLineNumber),
    }
}

export function getCurrentFileId<
    Row extends { row: { fileId: FileId; type?: string } },
>(rows: readonly Row[], scrollTop: number): FileId | null {
    if (rows.length === 0) return null
    const index = Math.min(rows.length - 1, Math.max(0, Math.floor(scrollTop)))
    const current = rows[index]?.row
    if (!current) return null
    if (current.type === "file-gap") {
        return rows[index + 1]?.row.fileId ?? current.fileId
    }
    return current.fileId
}

export function getFileScrollTailHeight<
    Row extends { row: { fileId: FileId; type: string } },
>(
    rows: readonly Row[],
    viewportHeight: number,
    leadingContentHeight = 0,
): number {
    const offsets = getFileRowOffsets(rows)
    if (offsets.size <= 1) return 0
    if (leadingContentHeight + rows.length <= viewportHeight) return 0
    const lastHeaderOffset = Array.from(offsets.values()).at(-1)
    if (lastHeaderOffset === undefined) return 0
    const rowsAfterHeader = rows.length - lastHeaderOffset
    return Math.max(0, viewportHeight - rowsAfterHeader)
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
    return rows.findIndex(
        (r) => r.fileId === fileId && r.type === "file-header",
    )
}

export function getHunkRowOffsets(
    rows: readonly { row: { hunkId: HunkId | null } }[],
): Map<HunkId, number> {
    const offsets = new Map<HunkId, number>()
    for (const [index, { row }] of rows.entries()) {
        if (row.hunkId && !offsets.has(row.hunkId)) {
            offsets.set(row.hunkId, index)
        }
    }
    return offsets
}

export function getFileRowOffsets(
    rows: readonly { row: { fileId: FileId; type: string } }[],
): Map<FileId, number> {
    const offsets = new Map<FileId, number>()
    for (const [index, { row }] of rows.entries()) {
        if (row.type === "file-header" && !offsets.has(row.fileId)) {
            offsets.set(row.fileId, index)
        }
    }
    return offsets
}

export interface HunkPosition {
    fileIndex: number
    hunkIndex: number
    hunkId: HunkId
}

export function getAdjacentHunk(
    files: readonly { hunks: readonly { hunkId: HunkId }[] }[],
    fileIndex: number,
    hunkIndex: number,
    direction: 1 | -1,
): HunkPosition | undefined {
    const positions = files.flatMap((file, currentFileIndex) =>
        file.hunks.map((hunk, currentHunkIndex) => ({
            fileIndex: currentFileIndex,
            hunkIndex: currentHunkIndex,
            hunkId: hunk.hunkId,
        })),
    )
    const currentIndex = positions.findIndex(
        (position) =>
            position.fileIndex === fileIndex &&
            position.hunkIndex === hunkIndex,
    )
    if (currentIndex === -1) return undefined
    return positions[currentIndex + direction]
}

export function getAdjacentHunkFromRow(
    files: readonly { hunks: readonly { hunkId: HunkId }[] }[],
    offsets: ReadonlyMap<HunkId, number>,
    row: number,
    direction: 1 | -1,
): HunkPosition | undefined {
    const positions = files
        .flatMap((file, fileIndex) =>
            file.hunks.map((hunk, hunkIndex) => ({
                fileIndex,
                hunkIndex,
                hunkId: hunk.hunkId,
                row: offsets.get(hunk.hunkId),
            })),
        )
        .filter(
            (position): position is HunkPosition & { row: number } =>
                position.row !== undefined,
        )

    const position =
        direction === 1
            ? positions.find((candidate) => candidate.row > row)
            : positions.findLast((candidate) => candidate.row < row)
    if (!position) return undefined
    return {
        fileIndex: position.fileIndex,
        hunkIndex: position.hunkIndex,
        hunkId: position.hunkId,
    }
}
