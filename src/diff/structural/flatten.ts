import { type HunkId, fileId } from "../identifiers"
import {
    type AlignedLinePair,
    type DiffFile,
    type DiffLine,
    type FlattenedFile,
    type FlattenedHunk,
    TAB_WIDTH,
    expandTabs,
} from "../parser"
import type { WordDiffSegment } from "../word-diff"
import type { DifftChange, DifftSide, StructuralFileResult } from "./difft-json"

/** Aligned rows of context kept around each structural change. */
const CONTEXT_ROWS = 3

/** Files that can meaningfully go through the structural engine. */
export function structuralCandidate(file: DiffFile): boolean {
    return !file.isBinary && file.type !== "new" && file.type !== "deleted"
}

export type StructuralFlattenResult =
    /** Difftastic produced usable alignment; render structurally. */
    | { kind: "structural"; file: FlattenedFile }
    /** Difftastic found no structural change (formatting/whitespace only). */
    | { kind: "formatting-only" }
    /** Not structurally representable; use the textual engine. */
    | { kind: "textual" }

function byteOffsetToStringIndex(text: string, byteOffset: number): number {
    return Buffer.from(text).subarray(0, byteOffset).toString().length
}

/**
 * Convert Difftastic byte-offset change ranges into emphasis segments over
 * the raw (tab-unexpanded) line content.
 */
export function structuralSegments(
    content: string,
    changes: DifftChange[],
    type: "added" | "removed",
): WordDiffSegment[] {
    if (changes.length === 0) return [{ text: content, type: "unchanged" }]

    const segments: WordDiffSegment[] = []
    let cursor = 0
    for (const change of [...changes].sort((a, b) => a.start - b.start)) {
        const start = byteOffsetToStringIndex(content, change.start)
        const end = byteOffsetToStringIndex(content, change.end)
        if (start > cursor) {
            segments.push({
                text: content.slice(cursor, start),
                type: "unchanged",
            })
        }
        if (end > start) {
            segments.push({ text: content.slice(start, end), type })
        }
        cursor = Math.max(cursor, end)
    }
    if (cursor < content.length) {
        segments.push({ text: content.slice(cursor), type: "unchanged" })
    }
    return segments
}

/**
 * Emphasis is only meaningful for partial replacements: when every
 * non-whitespace character of the line changed, the line background already
 * communicates everything and per-token emphasis is pure noise.
 */
function partialStructuralSegments(
    content: string,
    changes: DifftChange[],
    type: "added" | "removed",
): WordDiffSegment[] | undefined {
    const segments = structuralSegments(content, changes, type)
    return segments.some(
        (segment) => segment.type === "unchanged" && /\S/.test(segment.text),
    )
        ? segments
        : undefined
}

/**
 * Expand tabs across a segment sequence while tracking the running column,
 * so expansion matches what `expandTabs` would produce for the whole line.
 */
function expandTabsInSegments(segments: WordDiffSegment[]): WordDiffSegment[] {
    let column = 0
    return segments.map((segment) => {
        let text = ""
        for (const char of segment.text) {
            if (char === "\t") {
                const pad = TAB_WIDTH - (column % TAB_WIDTH)
                text += " ".repeat(pad)
                column += pad
                continue
            }
            text += char
            column += 1
        }
        return { ...segment, text }
    })
}

interface SideLine {
    line: DiffLine
    emphasisSource?: {
        raw: string
        changes: DifftChange[]
        type: "added" | "removed"
    }
}

function makeChangedLine(
    kind: "deletion" | "addition",
    raw: string,
    lineNumber: number,
    hunkId: HunkId,
    counterpartPresent: boolean,
    changes: DifftChange[],
): DiffLine {
    const line: DiffLine = {
        type: kind,
        content: expandTabs(raw),
        hunkId,
    }
    if (kind === "deletion") line.oldLineNumber = lineNumber
    else line.newLineNumber = lineNumber

    // One-sided lines get no emphasis: there is nothing they changed *from*.
    if (counterpartPresent) {
        const segments = partialStructuralSegments(
            raw,
            changes,
            kind === "deletion" ? "removed" : "added",
        )
        if (segments) line.wordDiff = expandTabsInSegments(segments)
    }
    return line
}

/**
 * Map one Difftastic file result onto Kajji's flattened rendering model.
 *
 * Produces both the unified representation (`hunk.lines`, in aligned order)
 * and the split representation (`hunk.alignedRows`, pre-paired from
 * Difftastic's alignment) so views stay dumb consumers.
 */
export function flattenStructuralFile(
    file: DiffFile,
    oldContent: string,
    newContent: string,
    result: StructuralFileResult,
): StructuralFlattenResult {
    if (result.status === "unchanged") return { kind: "formatting-only" }

    const aligned = result.aligned_lines
    const chunks = result.chunks
    if (!aligned?.length || !chunks?.length || result.status !== "changed") {
        return { kind: "textual" }
    }

    const oldLines = oldContent.split("\n")
    const newLines = newContent.split("\n")

    // Index alignment pairs by source line for chunk -> range mapping.
    const alignmentIndex = new Map<string, number>()
    for (const [index, [oldLine, newLine]] of aligned.entries()) {
        if (oldLine !== null) alignmentIndex.set(`l:${oldLine}`, index)
        if (newLine !== null) alignmentIndex.set(`r:${newLine}`, index)
    }

    const changedOld = new Map<number, DifftSide>()
    const changedNew = new Map<number, DifftSide>()
    const ranges: Array<{ start: number; end: number }> = []

    for (const chunk of chunks) {
        let start = Number.POSITIVE_INFINITY
        let end = -1
        for (const line of chunk) {
            if (line.lhs) {
                changedOld.set(line.lhs.line_number, line.lhs)
                const index = alignmentIndex.get(`l:${line.lhs.line_number}`)
                if (index !== undefined) {
                    start = Math.min(start, index)
                    end = Math.max(end, index)
                }
            }
            if (line.rhs) {
                changedNew.set(line.rhs.line_number, line.rhs)
                const index = alignmentIndex.get(`r:${line.rhs.line_number}`)
                if (index !== undefined) {
                    start = Math.min(start, index)
                    end = Math.max(end, index)
                }
            }
        }
        if (end >= 0) {
            ranges.push({
                start: Math.max(0, start - CONTEXT_ROWS),
                end: Math.min(aligned.length - 1, end + CONTEXT_ROWS),
            })
        }
    }

    ranges.sort((a, b) => a.start - b.start)
    const mergedRanges: Array<{ start: number; end: number }> = []
    for (const range of ranges) {
        const previous = mergedRanges.at(-1)
        if (previous && range.start <= previous.end + 1) {
            previous.end = Math.max(previous.end, range.end)
        } else {
            mergedRanges.push({ ...range })
        }
    }

    const fid = fileId(file)
    const hunks: FlattenedHunk[] = mergedRanges.map((range) => {
        const pairs = aligned.slice(range.start, range.end + 1)
        const presentOld = pairs.flatMap(([line]) =>
            line === null ? [] : [line],
        )
        const presentNew = pairs.flatMap(([, line]) =>
            line === null ? [] : [line],
        )
        const oldStart = (presentOld[0] ?? 0) + 1
        const newStart = (presentNew[0] ?? 0) + 1
        const hunkId =
            `${fid}:difft:${oldStart},${presentOld.length}+${newStart},${presentNew.length}` as HunkId

        const lines: DiffLine[] = []
        const alignedRows: AlignedLinePair[] = []

        for (const [oldLine, newLine] of pairs) {
            const rawOld = oldLine === null ? null : (oldLines[oldLine] ?? "")
            const rawNew = newLine === null ? null : (newLines[newLine] ?? "")
            const oldChange =
                oldLine === null ? undefined : changedOld.get(oldLine)
            const newChange =
                newLine === null ? undefined : changedNew.get(newLine)

            // Demote structurally unchanged pairs — and identical pairs even
            // when Difftastic reports changes for them. Multiline string
            // atoms (e.g. template literals) are single lexical nodes, so a
            // one-line edit inside marks every line of the string as changed
            // on both sides, but identical text carries no reviewable
            // difference.
            if (
                oldLine !== null &&
                newLine !== null &&
                ((!oldChange && !newChange) || rawOld === rawNew)
            ) {
                if (rawOld === rawNew) {
                    const context: DiffLine = {
                        type: "context",
                        content: expandTabs(rawOld ?? ""),
                        oldLineNumber: oldLine + 1,
                        newLineNumber: newLine + 1,
                        hunkId,
                    }
                    lines.push(context)
                    alignedRows.push({ left: context, right: context })
                } else {
                    // Structurally unchanged but textually different (e.g.
                    // reindented). Unified shows the new side once; split
                    // shows both sides as neutral context.
                    const left: DiffLine = {
                        type: "context",
                        content: expandTabs(rawOld ?? ""),
                        oldLineNumber: oldLine + 1,
                        hunkId,
                    }
                    const right: DiffLine = {
                        type: "context",
                        content: expandTabs(rawNew ?? ""),
                        newLineNumber: newLine + 1,
                        hunkId,
                    }
                    lines.push(right)
                    alignedRows.push({ left, right })
                }
                continue
            }

            const left =
                oldLine === null
                    ? null
                    : makeChangedLine(
                          "deletion",
                          rawOld ?? "",
                          oldLine + 1,
                          hunkId,
                          newLine !== null,
                          oldChange?.changes ?? [],
                      )
            const right =
                newLine === null
                    ? null
                    : makeChangedLine(
                          "addition",
                          rawNew ?? "",
                          newLine + 1,
                          hunkId,
                          oldLine !== null,
                          newChange?.changes ?? [],
                      )

            if (left) lines.push(left)
            if (right) lines.push(right)
            alignedRows.push({ left, right })
        }

        return {
            hunkId,
            lines,
            oldStart,
            oldLines: presentOld.length,
            newStart,
            newLines: presentNew.length,
            alignedRows,
        }
    })

    // Keep the textual +/- stats: they arrive free, users can reconcile
    // them, and structural "stats" would be an invented metric.
    let additions = 0
    let deletions = 0
    for (const hunk of file.hunks) {
        additions += hunk.additionLines
        deletions += hunk.deletionLines
    }

    return {
        kind: "structural",
        file: {
            fileId: fid,
            name: file.name,
            prevName: file.prevName,
            type: file.type,
            hunks,
            additions,
            deletions,
            isBinary: file.isBinary,
            structural: true,
        },
    }
}
