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
 * merged, and a single-character unchanged gap (typically a space) between
 * two changed segments is absorbed into the highlight so changed runs read
 * as one continuous span instead of speckled fragments.
 */
function pushOrJoinSegment(
    segments: WordDiffSegment[],
    text: string,
    type: WordDiffSegment["type"],
    isLastItem: boolean,
): void {
    const last = segments[segments.length - 1]
    if (!last || isLastItem) {
        segments.push({ text, type })
        return
    }
    const isNeutral = type === "unchanged"
    const isLastNeutral = last.type === "unchanged"
    if (
        isNeutral === isLastNeutral ||
        // Absorb a single-character unchanged gap into a preceding highlight
        (isNeutral && text.length === 1 && !isLastNeutral)
    ) {
        last.text += text
        return
    }
    segments.push({ text, type })
}

/**
 * Compute word-level differences between two lines using "word-alt"
 * highlighting: word diffs with single-space gaps joined into continuous
 * highlight spans.
 * Returns an array of segments for highlighting.
 */
export function computeWordDiff(
    oldLine: string,
    newLine: string,
): { old: WordDiffSegment[]; new: WordDiffSegment[] } {
    const changes = diffWordsWithSpace(oldLine, newLine)

    const oldSegments: WordDiffSegment[] = []
    const newSegments: WordDiffSegment[] = []

    const lastChange = changes[changes.length - 1]
    for (const change of changes) {
        const isLastItem = change === lastChange
        if (change.added) {
            pushOrJoinSegment(newSegments, change.value, "added", isLastItem)
        } else if (change.removed) {
            pushOrJoinSegment(oldSegments, change.value, "removed", isLastItem)
        } else {
            // Unchanged - appears in both
            pushOrJoinSegment(oldSegments, change.value, "unchanged", isLastItem)
            pushOrJoinSegment(newSegments, change.value, "unchanged", isLastItem)
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
