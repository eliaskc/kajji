// Identifiers (stable IDs)
export {
    fileId,
    findFileById,
    findHunkById,
    getHunkIds,
    hunkId,
    lineAnchorKey,
    type FileId,
    type HunkId,
    type LineAnchor,
} from "./identifiers"

// Parser and utilities
export {
    fetchParsedDiff,
    fetchParsedDiffRange,
    flattenDiff,
    flattenFile,
    flattenHunk,
    getDiffTotals,
    getFileStatusIndicator,
    getLineNumWidth,
    getMaxLineNumber,
    parseDiffString,
    type DiffFile,
    type DiffLine,
    type DiffLineType,
    type FlattenedFile,
    type FlattenedHunk,
    type ParseDiffOptions,
} from "./parser"

// Re-export @pierre/diffs types
export type {
    ChangeContent,
    ContextContent,
    FileDiffMetadata,
    Hunk,
    ParsedPatch,
} from "./parser"

// State types
export {
    createDiffState,
    type DiffActions,
    type DiffAnnotation,
    type DiffMode,
    type DiffState,
    type DiffViewStyle,
    type HunkSelection,
} from "./types"

// Word-level diff utilities
export {
    computeChangePairDiff,
    computeWordDiff,
    shouldComputeWordDiff,
    type WordDiffSegment,
} from "./word-diff"

// Syntax highlighting (worker-based shiki)
export {
    clearTokenCache,
    getLanguage,
    getTokenCacheStats,
    highlighterReady,
    initHighlighter,
    isHighlighterReady,
    tokenizeLine,
    tokenizeLineSync,
    tokenVersion,
    type SyntaxToken,
} from "./syntax"

export type { SupportedLanguages } from "@pierre/diffs"

// Virtualization
export {
    findRowIndexByFileId,
    findRowIndexByHunkId,
    flattenToRows,
    getAdjacentHunk,
    getCurrentFileId,
    getFileRowOffsets,
    getFileScrollTailHeight,
    getHunkRowOffsets,
    getVisibleRange,
    type DiffRow,
    type DiffRowType,
    type HunkPosition,
    type ViewportState,
} from "./virtualization"
