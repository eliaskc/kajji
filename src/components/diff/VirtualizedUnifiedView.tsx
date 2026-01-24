import type { MouseEvent } from "@opentui/core"
import { For, Show, createMemo } from "solid-js"
import { useTheme } from "../../context/theme"
import {
	type DiffRow,
	type FileId,
	type FlattenedFile,
	type HunkId,
	type SyntaxToken,
	flattenToRows,
	getLanguage,
	getLineNumWidth,
	getMaxLineNumber,
	getVisibleRange,
	highlighterReady,
	tokenVersion,
	tokenizeLineSync,
} from "../../diff"

const DIFF_BG = {
	addition: "#0d2818",
	deletion: "#2d1215",
	additionEmphasis: "#1a5a2a",
	deletionEmphasis: "#5a1a1a",
} as const

const BAR_COLORS = {
	addition: "#3fb950",
	deletion: "#f85149",
} as const

const LINE_NUM_COLORS = {
	addition: "#3fb950",
	deletion: "#f85149",
	context: "#6e7681",
} as const

const BAR_CHAR = "▌"
const SEPARATOR_COLOR = "#30363d"
const GAP_ROW_BG = "#161b22"
const GAP_PATTERN_CHAR = "╱"
const GAP_PATTERN_COLOR = "#2a2a2a"
const GAP_PATTERN_REPEAT = 200
const RIGHT_PADDING = 2

const STAT_COLORS = {
	addition: "#3fb950",
	deletion: "#f85149",
}

interface VirtualizedUnifiedViewProps {
	files: FlattenedFile[]
	activeFileId?: FileId | null
	currentHunkId?: HunkId | null
	scrollTop: number
	viewportHeight: number
	viewportWidth: number
	wrapEnabled: boolean
	scrollLeft: number
	onHorizontalScroll?: (event: MouseEvent) => void
}

type WrappedRow =
	| { type: "file-header" | "gap" | "file-gap"; row: DiffRow }
	| {
			type: "content"
			row: DiffRow
			lineStart: number
			lineLength: number
			isWrapped: boolean
	  }

export function VirtualizedUnifiedView(props: VirtualizedUnifiedViewProps) {
	const { colors } = useTheme()

	const filesToRender = createMemo(() => {
		if (props.activeFileId) {
			const file = props.files.find((f) => f.fileId === props.activeFileId)
			return file ? [file] : []
		}
		return props.files
	})

	const rows = createMemo(() => flattenToRows(filesToRender()))

	const lineNumWidth = createMemo(() => {
		const maxLine = getMaxLineNumber(props.files)
		return Math.max(1, getLineNumWidth(maxLine))
	})

	const wrapWidth = createMemo(() => {
		const width = Math.max(1, props.viewportWidth)
		const prefixWidth = lineNumWidth() + 5
		return Math.max(1, width - prefixWidth - RIGHT_PADDING)
	})

	const wrappedRows = createMemo(() =>
		buildWrappedRows(rows(), wrapWidth(), props.wrapEnabled, props.scrollLeft),
	)

	const visibleRange = createMemo(() =>
		getVisibleRange({
			scrollTop: props.scrollTop,
			viewportHeight: props.viewportHeight,
			totalRows: wrappedRows().length,
		}),
	)

	const visibleRows = createMemo(() => {
		const { start, end } = visibleRange()
		return wrappedRows().slice(start, end)
	})

	const fileStats = createMemo(() => {
		const stats = new Map<
			FileId,
			{ additions: number; deletions: number; prevName?: string; type: string }
		>()
		for (const file of filesToRender()) {
			stats.set(file.fileId, {
				additions: file.additions,
				deletions: file.deletions,
				prevName: file.prevName,
				type: file.type,
			})
		}
		return stats
	})

	return (
		<box flexDirection="column">
			<Show when={rows().length === 0}>
				<text fg={colors().textMuted}>No changes</text>
			</Show>
			<Show when={rows().length > 0}>
				<box height={visibleRange().start} flexShrink={0} />
				<For each={visibleRows()}>
					{(row) => (
						<VirtualizedRow
							row={row}
							lineNumWidth={lineNumWidth()}
							currentHunkId={props.currentHunkId}
							fileStats={fileStats()}
							highlighterReady={highlighterReady}
							onHorizontalScroll={props.onHorizontalScroll}
						/>
					)}
				</For>
				<box
					height={wrappedRows().length - visibleRange().end}
					flexShrink={0}
				/>
			</Show>
		</box>
	)
}

interface VirtualizedRowProps {
	row: WrappedRow
	lineNumWidth: number
	currentHunkId?: HunkId | null
	fileStats: Map<
		FileId,
		{ additions: number; deletions: number; prevName?: string; type: string }
	>
	highlighterReady: () => boolean
	onHorizontalScroll?: (event: MouseEvent) => void
}

function VirtualizedRow(props: VirtualizedRowProps) {
	const { colors } = useTheme()

	if (props.row.type === "file-header") {
		const stats = props.fileStats.get(props.row.row.fileId)
		return (
			<box paddingRight={1}>
				<box flexDirection="row" justifyContent="space-between" flexGrow={1}>
					<text>
						<span style={{ fg: "#ffffff" }}>{props.row.row.content}</span>
						<Show when={stats?.prevName}>
							<span style={{ fg: colors().textMuted }}>
								{" ← "}
								{stats?.prevName}
							</span>
						</Show>
					</text>
					<Show when={stats && (stats.additions > 0 || stats.deletions > 0)}>
						<text>
							<Show when={stats && stats.additions > 0}>
								<span style={{ fg: STAT_COLORS.addition }}>
									+{stats?.additions}
								</span>
							</Show>
							<Show when={stats && stats.additions > 0 && stats.deletions > 0}>
								<span> </span>
							</Show>
							<Show when={stats && stats.deletions > 0}>
								<span style={{ fg: STAT_COLORS.deletion }}>
									-{stats?.deletions}
								</span>
							</Show>
						</text>
					</Show>
				</box>
			</box>
		)
	}

	if (props.row.type === "gap") {
		const gutterWidth = props.lineNumWidth + 2
		const ellipsis = "···"
		const pattern = GAP_PATTERN_CHAR.repeat(GAP_PATTERN_REPEAT)
		const gutterPattern = GAP_PATTERN_CHAR.repeat(
			Math.max(0, gutterWidth - ellipsis.length),
		)
		return (
			<box backgroundColor={GAP_ROW_BG} overflow="hidden">
				<text wrapMode="none">
					<span style={{ fg: GAP_PATTERN_COLOR }}>{gutterPattern}</span>
					<span style={{ fg: colors().textMuted }}>{ellipsis}</span>
					<span style={{ fg: GAP_PATTERN_COLOR }}>{pattern}</span>
				</text>
			</box>
		)
	}

	if (props.row.type === "file-gap") {
		return (
			<box paddingLeft={1}>
				<text> </text>
			</box>
		)
	}

	if (props.row.type !== "content") return null

	const contentRow = props.row
	return (
		<DiffLineRow
			row={contentRow.row}
			lineStart={contentRow.lineStart}
			lineLength={contentRow.lineLength}
			lineNumWidth={props.lineNumWidth}
			highlighterReady={props.highlighterReady}
			isWrapped={contentRow.isWrapped}
			onHorizontalScroll={props.onHorizontalScroll}
		/>
	)
}

interface DiffLineRowProps {
	row: DiffRow
	lineStart: number
	lineLength: number
	isWrapped: boolean
	lineNumWidth: number
	highlighterReady: () => boolean
	onHorizontalScroll?: (event: MouseEvent) => void
}

function DiffLineRow(props: DiffLineRowProps) {
	const { colors } = useTheme()

	const language = createMemo(() => getLanguage(props.row.fileName))

	const lineBg = createMemo(() => {
		switch (props.row.type) {
			case "addition":
				return DIFF_BG.addition
			case "deletion":
				return DIFF_BG.deletion
			default:
				return undefined
		}
	})

	// Worker-based tokenization - returns immediately, re-renders when tokens arrive
	const tokens = createMemo((): SyntaxToken[] => {
		// Track tokenVersion to re-render when worker sends new tokens
		tokenVersion()

		// Strip trailing newline - shiki does this internally, but plain text fallback doesn't
		const content = props.row.content.replace(/\n$/, "")
		const defaultColor = colors().text

		// If highlighter not ready, return plain text
		if (!props.highlighterReady()) {
			return [{ content, color: defaultColor }]
		}

		// Request tokenization from worker (returns cached or queues request)
		const result = tokenizeLineSync(content, language())
		return result.map((t) => ({
			content: t.content,
			color: t.color ?? defaultColor,
		}))
	})

	const lineNum = createMemo(() => {
		if (props.isWrapped) return " ".repeat(props.lineNumWidth)
		const num =
			props.row.type === "deletion"
				? props.row.oldLineNumber
				: props.row.newLineNumber
		return (num?.toString() ?? "").padStart(props.lineNumWidth, " ")
	})

	const lineNumColor = createMemo(() => {
		switch (props.row.type) {
			case "deletion":
				return LINE_NUM_COLORS.deletion
			case "addition":
				return LINE_NUM_COLORS.addition
			default:
				return LINE_NUM_COLORS.context
		}
	})

	const bar = createMemo(() => {
		switch (props.row.type) {
			case "addition":
				return { char: BAR_CHAR, color: BAR_COLORS.addition }
			case "deletion":
				return { char: BAR_CHAR, color: BAR_COLORS.deletion }
			default:
				return { char: " ", color: undefined }
		}
	})

	return (
		<box flexDirection="row" backgroundColor={lineBg()} flexGrow={1}>
			<text wrapMode="none" onMouseScroll={props.onHorizontalScroll}>
				<span style={{ fg: bar().color }}>{bar().char}</span>
				<span style={{ fg: lineNumColor() }}> {lineNum()} </span>
				<span style={{ fg: SEPARATOR_COLOR }}>│</span>
				<span> </span>
				<For each={sliceTokens(tokens(), props.lineStart, props.lineLength)}>
					{(token) => <span style={{ fg: token.color }}>{token.content}</span>}
				</For>
			</text>
		</box>
	)
}

function buildWrappedRows(
	rows: DiffRow[],
	wrapWidth: number,
	wrapEnabled: boolean,
	scrollLeft: number,
): WrappedRow[] {
	const result: WrappedRow[] = []
	const width = Math.max(1, wrapWidth)

	for (const row of rows) {
		if (
			row.type === "file-header" ||
			row.type === "gap" ||
			row.type === "file-gap"
		) {
			result.push({ type: row.type, row })
			continue
		}

		const content = row.content.replace(/\n$/, "")
		const contentLength = content.length
		if (!wrapEnabled) {
			const start = scrollLeft
			result.push({
				type: "content",
				row,
				lineStart: start,
				lineLength: Math.min(width - 1, Math.max(0, contentLength - start)),
				isWrapped: false,
			})
			continue
		}

		const totalLines = Math.max(1, Math.ceil(contentLength / width))

		for (let i = 0; i < totalLines; i += 1) {
			const start = i * width
			const lineLength = Math.min(width, Math.max(0, contentLength - start))
			result.push({
				type: "content",
				row,
				lineStart: start,
				lineLength,
				isWrapped: i > 0,
			})
		}
	}

	return result
}

function sliceTokens<T extends { content: string }>(
	tokens: T[],
	start: number,
	length: number,
): T[] {
	if (length <= 0) return []
	const end = start + length
	let offset = 0
	const result: T[] = []

	for (const token of tokens) {
		const tokenLength = token.content.length
		const tokenStart = offset
		const tokenEnd = offset + tokenLength
		offset = tokenEnd

		if (tokenEnd <= start) continue
		if (tokenStart >= end) break

		const sliceStart = Math.max(0, start - tokenStart)
		const sliceEnd = Math.min(tokenLength, end - tokenStart)
		if (sliceEnd > sliceStart) {
			result.push({
				...token,
				content: token.content.slice(sliceStart, sliceEnd),
			})
		}
	}

	return result
}
