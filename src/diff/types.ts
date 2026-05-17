import type { FileId, HunkId, LineAnchor } from "./identifiers"
import type { DiffFile } from "./parser"

/**
 * View mode for diff renderer.
 */
export type DiffMode = "view" | "split" | "review"

/**
 * Display style for diff.
 */
export type DiffViewStyle = "unified" | "split"

/**
 * Selection state for interactive splitting.
 */
export type HunkSelection = "keep" | "split"

/**
 * Annotation for PR review / AI explanations.
 */
export interface DiffAnnotation {
    anchor: LineAnchor
    type: "comment" | "suggestion" | "ai-explanation"
    content: string
    author?: string
    createdAt?: Date

    // GitHub sync (Phase 4)
    prCommentId?: number
    threadId?: string
    resolved?: boolean
    replyTo?: number
}

/**
 * State for the diff viewer.
 */
export interface DiffState {
    // Parsed diff data
    files: DiffFile[]

    // Mode
    mode: DiffMode
    viewStyle: DiffViewStyle

    // Navigation (by stable ID, not index)
    currentFileId: FileId | null
    currentHunkId: HunkId | null

    // Selection for split mode (keyed by stable hunk ID)
    hunkSelections: Map<HunkId, HunkSelection>

    // Annotations for review mode
    annotations: Map<string, DiffAnnotation[]> // key: lineAnchorKey()

    // Current file for file-at-a-time rendering
    activeFileId: FileId | null

    // Loading state
    loading: boolean
    error?: string
}

/**
 * Create initial diff state.
 */
export function createDiffState(
    files: DiffFile[] = [],
    mode: DiffMode = "view",
): DiffState {
    return {
        files,
        mode,
        viewStyle: "unified",
        currentFileId: null,
        currentHunkId: null,
        hunkSelections: new Map(),
        annotations: new Map(),
        activeFileId: files.length > 0 ? (files[0]?.name ?? null) : null,
        loading: false,
    }
}

/**
 * Actions for diff state updates.
 */
export interface DiffActions {
    setFiles: (files: DiffFile[]) => void
    setMode: (mode: DiffMode) => void
    setViewStyle: (style: DiffViewStyle) => void
    setActiveFile: (fileId: FileId | null) => void
    navigateToHunk: (hunkId: HunkId) => void
    toggleHunkSelection: (hunkId: HunkId) => void
    setLoading: (loading: boolean) => void
    setError: (error: string | undefined) => void
}
