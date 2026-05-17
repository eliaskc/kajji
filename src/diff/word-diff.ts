import { diffWordsWithSpace } from "diff"

/**
 * A segment of text with change information.
 */
export interface WordDiffSegment {
    text: string
    type: "unchanged" | "added" | "removed"
}

/**
 * Compute word-level differences between two lines.
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
            newSegments.push({ text: change.value, type: "added" })
        } else if (change.removed) {
            oldSegments.push({ text: change.value, type: "removed" })
        } else {
            // Unchanged - appears in both
            oldSegments.push({ text: change.value, type: "unchanged" })
            newSegments.push({ text: change.value, type: "unchanged" })
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
