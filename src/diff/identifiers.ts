import type { FileDiffMetadata, Hunk } from "@pierre/diffs"

/**
 * Stable file identifier.
 * - For renames: `${prevName}->${name}`
 * - Otherwise: just the path
 *
 * This survives file reordering, filtering, and sorting.
 */
export type FileId = string

/**
 * Create a stable file identifier from file metadata.
 */
export function fileId(file: FileDiffMetadata): FileId {
    if (file.prevName) {
        return `${file.prevName}->${file.name}`
    }
    return file.name
}

/**
 * Stable hunk identifier derived from header coordinates.
 * Format: `${path}:@${deletionStart},${deletionLines}+${additionStart},${additionLines}`
 *
 * This survives file reordering and provides a unique key for each hunk.
 */
export type HunkId = string

/**
 * Create a stable hunk identifier.
 */
export function hunkId(file: FileDiffMetadata, hunk: Hunk): HunkId {
    const fid = fileId(file)
    // Use the exact hunk coordinates for uniqueness
    return `${fid}:@${hunk.deletionStart},${hunk.deletionLines}+${hunk.additionStart},${hunk.additionLines}`
}

/**
 * Line anchor for PR comments (matches GitHub API).
 * This is used in Phase 4 (PR Review) but defined here for consistency.
 */
export interface LineAnchor {
    path: string
    side: "LEFT" | "RIGHT" // GitHub terminology: LEFT=old file, RIGHT=new file
    line: number

    // For multi-line comments
    startLine?: number
    startSide?: "LEFT" | "RIGHT"
}

/**
 * Create a string key for a line anchor (for Map lookups).
 */
export function lineAnchorKey(anchor: LineAnchor): string {
    return `${anchor.path}:${anchor.side}:${anchor.line}`
}

/**
 * Find a file by its stable ID.
 */
export function findFileById(
    files: FileDiffMetadata[],
    id: FileId,
): FileDiffMetadata | undefined {
    return files.find((f) => fileId(f) === id)
}

/**
 * Find a hunk by its stable ID.
 */
export function findHunkById(
    files: FileDiffMetadata[],
    id: HunkId,
): { file: FileDiffMetadata; hunk: Hunk } | undefined {
    for (const file of files) {
        for (const hunk of file.hunks) {
            if (hunkId(file, hunk) === id) {
                return { file, hunk }
            }
        }
    }
    return undefined
}

/**
 * Get all hunk IDs for a file.
 */
export function getHunkIds(file: FileDiffMetadata): HunkId[] {
    return file.hunks.map((hunk) => hunkId(file, hunk))
}
