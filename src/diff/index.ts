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
	flattenDiff,
	flattenFile,
	flattenHunk,
	getDiffTotals,
	getFileStatusIndicator,
	getLineNumWidth,
	getMaxLineNumber,
	parseDiffString,
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
	getVisibleRange,
	type DiffRow,
	type DiffRowType,
	type ViewportState,
} from "./virtualization"
