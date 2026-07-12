import { diffWordsWithSpace } from "diff"

/**
 * A segment of text with change information.
 */
export interface WordDiffSegment {
    text: string
    type: "unchanged" | "added" | "removed"
}

/**
 * Push a segment, joining it into the previous one when possible ("word-alt"
 * style, mirroring @pierre/diffs). Adjacent segments of the same kind are
 * merged. Whitespace stays neutral so indentation and spacing changes do not
 * add visual noise to word-level highlights.
 */
function pushOrJoinSegment(
    segments: WordDiffSegment[],
    text: string,
    type: WordDiffSegment["type"],
): void {
    if (!text) return
    const last = segments[segments.length - 1]
    if (!last) {
        segments.push({ text, type })
        return
    }
    if (type === last.type) {
        last.text += text
        return
    }
    segments.push({ text, type })
}

function pushChangedSegment(
    segments: WordDiffSegment[],
    text: string,
    type: "added" | "removed",
): void {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)
    if (!match) return
    pushOrJoinSegment(segments, match[1] ?? "", "unchanged")
    pushOrJoinSegment(segments, match[2] ?? "", type)
    pushOrJoinSegment(segments, match[3] ?? "", "unchanged")
}

/**
 * Compute word-level differences between two lines without highlighting
 * whitespace-only changes.
 * Returns an array of segments for highlighting.
 */
export function computeWordDiff(
    oldLine: string,
    newLine: string,
): { old: WordDiffSegment[]; new: WordDiffSegment[] } {
    const changes = diffWordsWithSpace(oldLine, newLine)

    const oldSegments: WordDiffSegment[] = []
    const newSegments: WordDiffSegment[] = []

    for (const change of changes) {
        if (change.added) {
            pushChangedSegment(newSegments, change.value, "added")
        } else if (change.removed) {
            pushChangedSegment(oldSegments, change.value, "removed")
        } else {
            // Unchanged - appears in both
            pushOrJoinSegment(oldSegments, change.value, "unchanged")
            pushOrJoinSegment(newSegments, change.value, "unchanged")
        }
    }

    return { old: oldSegments, new: newSegments }
}

/**
 * Check if word diff should be computed for a pair of lines.
 * Only compute for adjacent deletion/addition pairs.
 */
export function shouldComputeWordDiff(
    deletions: string[],
    additions: string[],
): boolean {
    // Only compute word diff if there's exactly one deletion and one addition
    // More complex cases would require alignment algorithms
    return deletions.length === 1 && additions.length === 1
}

/**
 * Compute word diffs for a change block (deletion/addition pair).
 * Returns maps from line content to highlighted segments.
 */
export function computeChangePairDiff(
    deletions: string[],
    additions: string[],
): {
    deletionHighlights: Map<string, WordDiffSegment[]>
    additionHighlights: Map<string, WordDiffSegment[]>
} {
    const deletionHighlights = new Map<string, WordDiffSegment[]>()
    const additionHighlights = new Map<string, WordDiffSegment[]>()

    if (shouldComputeWordDiff(deletions, additions)) {
        const oldLine = deletions[0] ?? ""
        const newLine = additions[0] ?? ""
        const { old, new: newSegs } = computeWordDiff(oldLine, newLine)
        deletionHighlights.set(oldLine, old)
        additionHighlights.set(newLine, newSegs)
    }

    return { deletionHighlights, additionHighlights }
}
