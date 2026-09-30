import type { FileId, HunkId } from "./identifiers"
import type { FlattenedFile } from "./parser"
import type { WordDiffSegment } from "./word-diff"

/** Visual and virtual row height reserved for each inline binary preview. */
export const BINARY_PREVIEW_HEIGHT = 9

export type DiffRowType =
    | "file-header"
    | "binary-preview"
    | "binary-preview-reserved-row"
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
    wordDiff?: WordDiffSegment[]
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

        if (file.isBinary) {
            // The first row owns the full-height preview component; the rest
            // reserve matching row positions for virtualization and scrolling.
            for (let row = 0; row < BINARY_PREVIEW_HEIGHT; row += 1) {
                rows.push({
                    type: row === 0 ? "binary-preview" : "binary-preview-reserved-row",
                    content: "",
                    fileId: file.fileId,
                    hunkId: null,
                    side: null,
                    rowIndex: rowIndex++,
                    fileName: file.name,
                })
            }
        }

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
                    wordDiff: line.wordDiff,
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

export function shouldShowStickyFileHeader(
    scrollTop: number,
    leadingContentHeight: number,
): boolean {
    return scrollTop > 0 && scrollTop >= leadingContentHeight
}

export interface DiffPosition {
    fileId: FileId
    lineNumber?: number
}

export interface DiffScrollAnchor {
    fileId: FileId
    newLineNumber?: number
    oldLineNumber?: number
    viewportOffset: number
}

/** A source-line pair can occupy several consecutive wrapped display rows. */
interface LineLocation {
    start: number
    end: number
    newLineNumber?: number
    oldLineNumber?: number
}

interface FileLayout {
    fileId: FileId
    start: number
    lines: LineLocation[]
    newLines: LineLocation[]
    oldLines: LineLocation[]
    firstNewLine: Map<number, number>
    firstOldLine: Map<number, number>
    firstPair: Map<string, number>
}

export interface DiffLayoutIndex {
    totalRows: number
    hunkOffsets: Map<HunkId, number>
    fileOffsets: Map<FileId, number>
    files: FileLayout[]
    filesById: Map<FileId, FileLayout>
    lastFileOffset: number | undefined
}

const pairKey = (newLine: number | undefined, oldLine: number | undefined) =>
    `${newLine ?? ""}:${oldLine ?? ""}`

/** Build once per row layout, never per scroll update. Files must be contiguous. */
export function buildDiffLayoutIndex<
    Row extends { row: { fileId: FileId; type?: string; hunkId?: HunkId | null } },
>(
    rows: readonly Row[],
    getNewLineNumber: (row: Row) => number | undefined,
    getOldLineNumber: (row: Row) => number | undefined,
    getRowHeight: (row: Row) => number = () => 1,
): DiffLayoutIndex {
    const layout: DiffLayoutIndex = {
        totalRows: 0,
        hunkOffsets: new Map(),
        fileOffsets: new Map(),
        files: [],
        filesById: new Map(),
        lastFileOffset: undefined,
    }
    let file: FileLayout | undefined
    for (const wrapped of rows) {
        const index = layout.totalRows
        const end = index + getRowHeight(wrapped)
        layout.totalRows = end
        const { row } = wrapped
        if (!file || file.fileId !== row.fileId) {
            file = {
                fileId: row.fileId,
                start: index,
                lines: [],
                newLines: [],
                oldLines: [],
                firstNewLine: new Map(),
                firstOldLine: new Map(),
                firstPair: new Map(),
            }
            layout.files.push(file)
            layout.filesById.set(row.fileId, file)
        }
        if (row.type === "file-header" && !layout.fileOffsets.has(row.fileId)) {
            layout.fileOffsets.set(row.fileId, index)
            layout.lastFileOffset = index
        }
        if (row.hunkId && !layout.hunkOffsets.has(row.hunkId)) {
            layout.hunkOffsets.set(row.hunkId, index)
        }
        const newLineNumber = getNewLineNumber(wrapped)
        const oldLineNumber = getOldLineNumber(wrapped)
        if (newLineNumber === undefined && oldLineNumber === undefined) continue
        const previous = file.lines.at(-1)
        if (
            previous?.end === index &&
            previous.newLineNumber === newLineNumber &&
            previous.oldLineNumber === oldLineNumber
        ) {
            previous.end = end
            continue
        }
        const location = { start: index, end, newLineNumber, oldLineNumber }
        file.lines.push(location)
        if (newLineNumber !== undefined) {
            file.newLines.push(location)
            if (!file.firstNewLine.has(newLineNumber)) file.firstNewLine.set(newLineNumber, index)
        }
        if (oldLineNumber !== undefined) {
            file.oldLines.push(location)
            if (!file.firstOldLine.has(oldLineNumber)) file.firstOldLine.set(oldLineNumber, index)
        }
        if (newLineNumber !== undefined && oldLineNumber !== undefined) {
            const key = pairKey(newLineNumber, oldLineNumber)
            if (!file.firstPair.has(key)) file.firstPair.set(key, index)
        }
    }
    return layout
}

/** First entry for which the predicate is true in a sorted collection. */
function lowerBound<T>(items: readonly T[], predicate: (item: T) => boolean): number {
    let low = 0
    let high = items.length
    while (low < high) {
        const mid = (low + high) >>> 1
        if (predicate(items[mid]!)) high = mid
        else low = mid + 1
    }
    return low
}

function currentLayoutFile(layout: DiffLayoutIndex, scrollTop: number) {
    if (layout.totalRows === 0) return undefined
    const top = Math.min(layout.totalRows - 1, Math.max(0, Math.floor(scrollTop)))
    return layout.files[lowerBound(layout.files, (file) => file.start > top) - 1]
}

function nearestLine(lines: readonly LineLocation[], row: number): LineLocation | undefined {
    const nextIndex = lowerBound(lines, (line) => line.end > row)
    const next = lines[nextIndex]
    const previous = lines[nextIndex - 1]
    if (!next) return previous
    if (!previous || next.start <= row) return next
    // At equal distance, retain the existing preference for the later row.
    return next.start - row <= row - (previous.end - 1) ? next : previous
}

export function findDiffScrollAnchorRowIndex(
    layout: DiffLayoutIndex,
    anchor: DiffScrollAnchor,
): number | null {
    const file = layout.filesById.get(anchor.fileId)
    if (!file) return null
    const { newLineNumber, oldLineNumber } = anchor
    if (newLineNumber !== undefined && oldLineNumber !== undefined) {
        // Split replacements pair lines that are separate rows in unified mode.
        return (
            file.firstPair.get(pairKey(newLineNumber, oldLineNumber)) ??
            file.firstNewLine.get(newLineNumber) ??
            file.firstOldLine.get(oldLineNumber) ??
            null
        )
    }
    if (newLineNumber !== undefined) return file.firstNewLine.get(newLineNumber) ?? null
    if (oldLineNumber !== undefined) return file.firstOldLine.get(oldLineNumber) ?? null
    return file.start
}

export function getCurrentDiffScrollAnchor(
    layout: DiffLayoutIndex,
    scrollTop: number,
    focusRow = scrollTop,
): DiffScrollAnchor | null {
    const file = currentLayoutFile(layout, scrollTop)
    if (!file) return null
    const focus = Math.min(layout.totalRows - 1, Math.max(0, Math.floor(focusRow)))
    const line = nearestLine(file.lines, focus)
    if (!line) return null
    return {
        fileId: file.fileId,
        newLineNumber: line.newLineNumber,
        oldLineNumber: line.oldLineNumber,
        viewportOffset: Math.max(line.start, Math.min(line.end - 1, focus)) - scrollTop,
    }
}

export function getCurrentDiffPosition(
    layout: DiffLayoutIndex,
    scrollTop: number,
    focusRow = scrollTop,
): DiffPosition | null {
    const file = currentLayoutFile(layout, scrollTop)
    if (!file) return null
    const focus = Math.min(layout.totalRows - 1, Math.max(0, Math.floor(focusRow)))
    // Empty side indexes make deletion-only and binary files constant-time fallbacks.
    const lineNumber = file.newLines.length
        ? nearestLine(file.newLines, focus)?.newLineNumber
        : nearestLine(file.oldLines, focus)?.oldLineNumber
    return { fileId: file.fileId, lineNumber }
}

export function getCurrentFileId<Row extends { row: { fileId: FileId } }>(
    rows: { length: number; at: (index: number) => Row | undefined },
    scrollTop: number,
): FileId | null {
    if (rows.length === 0) return null
    const index = Math.min(rows.length - 1, Math.max(0, Math.floor(scrollTop)))
    return rows.at(index)?.row.fileId ?? null
}

export function getFileScrollTailHeight(
    layout: DiffLayoutIndex,
    viewportHeight: number,
    leadingContentHeight = 0,
): number {
    if (layout.fileOffsets.size <= 1) return 0
    if (leadingContentHeight + layout.totalRows <= viewportHeight) return 0
    if (layout.lastFileOffset === undefined) return 0
    const rowsAfterHeader = layout.totalRows - layout.lastFileOffset
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

export interface HunkPosition {
    fileIndex: number
    hunkIndex: number
    hunkId: HunkId
}

export interface HunkRowPosition extends HunkPosition {
    row: number
}

export function buildHunkNavigationIndex(
    files: readonly { hunks: readonly { hunkId: HunkId }[] }[],
    offsets: ReadonlyMap<HunkId, number>,
): HunkRowPosition[] {
    const positions: HunkRowPosition[] = []
    for (const [fileIndex, file] of files.entries()) {
        for (const [hunkIndex, hunk] of file.hunks.entries()) {
            const row = offsets.get(hunk.hunkId)
            if (row !== undefined)
                positions.push({ fileIndex, hunkIndex, hunkId: hunk.hunkId, row })
        }
    }
    return positions.sort((a, b) => a.row - b.row)
}

export function getAdjacentHunkFromRow(
    positions: readonly HunkRowPosition[],
    row: number,
    direction: 1 | -1,
): HunkPosition | undefined {
    const index =
        direction === 1
            ? lowerBound(positions, (position) => position.row > row)
            : lowerBound(positions, (position) => position.row >= row) - 1
    return positions[index]
}
