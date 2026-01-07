import { For, Show, createMemo } from "solid-js"
import { useTheme } from "../../context/theme"
import type {
	DiffLine,
	FileId,
	FlattenedFile,
	FlattenedHunk,
	HunkId,
	SyntaxToken,
	WordDiffSegment,
} from "../../diff"
import {
	computeWordDiff,
	getFileStatusColor,
	getFileStatusIndicator,
	getLanguage,
	getLineNumWidth,
	getMaxLineNumber,
	getVisibleRange,
	tokenizeWithCache,
} from "../../diff"

const DIFF_BG = {
	addition: "#0d2818",
	deletion: "#2d1215",
	empty: "#161b22",
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

const SEPARATOR_COLOR = "#30363d"
const FILE_HEADER_BG = "#1c2128"
const HUNK_HEADER_BG = "#161b22"

const STAT_COLORS = {
	addition: "#3fb950",
	deletion: "#f85149",
}

const BAR_CHAR = "▌"
const EMPTY_STRIPE_CHAR = "╱"
const EMPTY_STRIPE_COLOR = "#2a2a2a"

type SplitRowType = "file-header" | "hunk-header" | "content"

interface SplitRow {
	type: SplitRowType
	fileId: FileId
	hunkId: HunkId | null
	fileName: string
	left: DiffLine | null
	right: DiffLine | null
	leftWordDiff?: WordDiffSegment[]
	rightWordDiff?: WordDiffSegment[]
	hunkHeader?: string
	rowIndex: number
}

function flattenToSplitRows(files: FlattenedFile[]): SplitRow[] {
	const rows: SplitRow[] = []
	let rowIndex = 0

	for (const file of files) {
		rows.push({
			type: "file-header",
			fileId: file.fileId,
			hunkId: null,
			fileName: file.name,
			left: null,
			right: null,
			rowIndex: rowIndex++,
		})

		for (const hunk of file.hunks) {
			rows.push({
				type: "hunk-header",
				fileId: file.fileId,
				hunkId: hunk.hunkId,
				fileName: file.name,
				left: null,
				right: null,
				hunkHeader: hunk.header,
				rowIndex: rowIndex++,
			})

			const alignedRows = buildAlignedRows(hunk.lines)
			for (const aligned of alignedRows) {
				rows.push({
					type: "content",
					fileId: file.fileId,
					hunkId: hunk.hunkId,
					fileName: file.name,
					left: aligned.left,
					right: aligned.right,
					leftWordDiff: aligned.leftWordDiff,
					rightWordDiff: aligned.rightWordDiff,
					rowIndex: rowIndex++,
				})
			}
		}
	}

	return rows
}

interface AlignedRow {
	left: DiffLine | null
	right: DiffLine | null
	leftWordDiff?: WordDiffSegment[]
	rightWordDiff?: WordDiffSegment[]
}

function buildAlignedRows(lines: DiffLine[]): AlignedRow[] {
	const rows: AlignedRow[] = []
	let i = 0

	while (i < lines.length) {
		const line = lines[i]
		if (!line) {
			i++
			continue
		}

		if (line.type === "context") {
			rows.push({ left: line, right: line })
			i++
		} else if (line.type === "deletion") {
			const deletions: DiffLine[] = []
			while (i < lines.length && lines[i]?.type === "deletion") {
				const del = lines[i]
				if (del) deletions.push(del)
				i++
			}

			const additions: DiffLine[] = []
			while (i < lines.length && lines[i]?.type === "addition") {
				const add = lines[i]
				if (add) additions.push(add)
				i++
			}

			const maxLen = Math.max(deletions.length, additions.length)
			for (let j = 0; j < maxLen; j++) {
				const del = deletions[j]
				const add = additions[j]
				const row: AlignedRow = {
					left: del ?? null,
					right: add ?? null,
				}

				if (del && add) {
					const { old: oldSegs, new: newSegs } = computeWordDiff(
						del.content,
						add.content,
					)
					row.leftWordDiff = oldSegs
					row.rightWordDiff = newSegs
				}

				rows.push(row)
			}
		} else if (line.type === "addition") {
			rows.push({ left: null, right: line })
			i++
		} else {
			i++
		}
	}

	return rows
}

interface VirtualizedSplitViewProps {
	files: FlattenedFile[]
	activeFileId?: FileId | null
	currentHunkId?: HunkId | null
	width: number
	scrollTop: number
	viewportHeight: number
}

export function VirtualizedSplitView(props: VirtualizedSplitViewProps) {
	const { colors } = useTheme()

	const filesToRender = createMemo(() => {
		if (props.activeFileId) {
			const file = props.files.find((f) => f.fileId === props.activeFileId)
			return file ? [file] : []
		}
		return props.files
	})

	const rows = createMemo(() => flattenToSplitRows(filesToRender()))

	const lineNumWidth = createMemo(() => {
		const maxLine = getMaxLineNumber(props.files)
		return Math.max(1, getLineNumWidth(maxLine))
	})

	const visibleRange = createMemo(() =>
		getVisibleRange({
			scrollTop: props.scrollTop,
			viewportHeight: props.viewportHeight,
			totalRows: rows().length,
		}),
	)

	const visibleRows = createMemo(() => {
		const { start, end } = visibleRange()
		return rows().slice(start, end)
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
				<box height={visibleRange().start} />
				<For each={visibleRows()}>
					{(row) => (
						<VirtualizedSplitRow
							row={row}
							lineNumWidth={lineNumWidth()}
							currentHunkId={props.currentHunkId}
							fileStats={fileStats()}
						/>
					)}
				</For>
				<box height={rows().length - visibleRange().end} />
			</Show>
		</box>
	)
}

interface VirtualizedSplitRowProps {
	row: SplitRow
	lineNumWidth: number
	currentHunkId?: HunkId | null
	fileStats: Map<
		FileId,
		{ additions: number; deletions: number; prevName?: string; type: string }
	>
}

function VirtualizedSplitRow(props: VirtualizedSplitRowProps) {
	const { colors } = useTheme()

	if (props.row.type === "file-header") {
		const stats = props.fileStats.get(props.row.fileId)
		return (
			<box backgroundColor={FILE_HEADER_BG} paddingLeft={1} paddingRight={1}>
				<text>
					<span style={{ fg: getFileStatusColor((stats?.type ?? "change") as "change" | "rename-pure" | "rename-changed" | "new" | "deleted") }}>
						{getFileStatusIndicator((stats?.type ?? "change") as "change" | "rename-pure" | "rename-changed" | "new" | "deleted")}
					</span>
					<span style={{ fg: colors().text }}> {props.row.fileName}</span>
					<Show when={stats?.prevName}>
						<span style={{ fg: colors().textMuted }}>
							{" ← "}
							{stats?.prevName}
						</span>
					</Show>
					<span style={{ fg: SEPARATOR_COLOR }}> │ </span>
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
			</box>
		)
	}

	if (props.row.type === "hunk-header") {
		const isCurrent = props.row.hunkId === props.currentHunkId
		return (
			<box backgroundColor={HUNK_HEADER_BG} paddingLeft={1}>
				<text>
					<span style={{ fg: isCurrent ? "#58a6ff" : "#6e7681" }}>
						{props.row.hunkHeader}
					</span>
				</text>
			</box>
		)
	}

	return (
		<SplitContentRow
			row={props.row}
			lineNumWidth={props.lineNumWidth}
		/>
	)
}

interface SplitContentRowProps {
	row: SplitRow
	lineNumWidth: number
}

interface TokenWithEmphasis extends SyntaxToken {
	emphasis?: boolean
}

function SplitContentRow(props: SplitContentRowProps) {
	const { colors } = useTheme()

	const language = createMemo(() => getLanguage(props.row.fileName))

	const formatLineNum = (num: number | undefined) =>
		(num?.toString() ?? "").padStart(props.lineNumWidth, " ")

	const tokenizeWithWordDiff = (
		content: string,
		wordDiff: WordDiffSegment[] | undefined,
		emphasisType: "removed" | "added",
	): TokenWithEmphasis[] => {
		if (!wordDiff) {
			const tokens = tokenizeWithCache(content, language())
			return tokens.map((t) => ({
				content: t.content,
				color: t.color ?? colors().text,
			}))
		}

		const result: TokenWithEmphasis[] = []
		for (const segment of wordDiff) {
			const segmentTokens = tokenizeWithCache(segment.text, language())
			const isEmphasis = segment.type === emphasisType
			for (const token of segmentTokens) {
				result.push({
					content: token.content,
					color: token.color ?? colors().text,
					emphasis: isEmphasis,
				})
			}
		}
		return result
	}

	const leftBg = createMemo(() => {
		if (!props.row.left) return DIFF_BG.empty
		return props.row.left.type === "deletion" ? DIFF_BG.deletion : undefined
	})

	const rightBg = createMemo(() => {
		if (!props.row.right) return DIFF_BG.empty
		return props.row.right.type === "addition" ? DIFF_BG.addition : undefined
	})

	const leftTokens = createMemo(() =>
		tokenizeWithWordDiff(
			props.row.left?.content ?? "",
			props.row.leftWordDiff,
			"removed",
		),
	)

	const rightTokens = createMemo(() =>
		tokenizeWithWordDiff(
			props.row.right?.content ?? "",
			props.row.rightWordDiff,
			"added",
		),
	)

	const leftLineNumColor = createMemo(() => {
		if (!props.row.left) return LINE_NUM_COLORS.context
		return props.row.left.type === "deletion"
			? LINE_NUM_COLORS.deletion
			: LINE_NUM_COLORS.context
	})

	const rightLineNumColor = createMemo(() => {
		if (!props.row.right) return LINE_NUM_COLORS.context
		return props.row.right.type === "addition"
			? LINE_NUM_COLORS.addition
			: LINE_NUM_COLORS.context
	})

	const leftBar = createMemo(() => {
		if (!props.row.left) return null
		if (props.row.left.type === "deletion")
			return { char: BAR_CHAR, color: BAR_COLORS.deletion }
		return { char: " ", color: undefined }
	})

	const rightBar = createMemo(() => {
		if (!props.row.right) return null
		if (props.row.right.type === "addition")
			return { char: BAR_CHAR, color: BAR_COLORS.addition }
		return { char: " ", color: undefined }
	})

	const emptyFill = createMemo(() => EMPTY_STRIPE_CHAR.repeat(500))

	return (
		<box flexDirection="row">
			<box
				backgroundColor={leftBg()}
				flexGrow={1}
				flexBasis={0}
				overflow="hidden"
			>
				<Show
					when={props.row.left}
					fallback={
						<text wrapMode="none">
							<span style={{ fg: EMPTY_STRIPE_COLOR }}>{emptyFill()}</span>
						</text>
					}
				>
					<text wrapMode="none">
						<span style={{ fg: leftBar()?.color }}>{leftBar()?.char}</span>
						<span style={{ fg: leftLineNumColor() }}>
							{" "}
							{formatLineNum(props.row.left?.oldLineNumber)}{" "}
						</span>
						<span style={{ fg: SEPARATOR_COLOR }}>│</span>
						<span> </span>
						<For each={leftTokens()}>
							{(token) => (
								<span
									style={{
										fg: token.color,
										bg: token.emphasis ? DIFF_BG.deletionEmphasis : undefined,
									}}
								>
									{token.content}
								</span>
							)}
						</For>
					</text>
				</Show>
			</box>
			<box width={1} />
			<box
				backgroundColor={rightBg()}
				flexGrow={1}
				flexBasis={0}
				overflow="hidden"
			>
				<Show
					when={props.row.right}
					fallback={
						<text wrapMode="none">
							<span style={{ fg: EMPTY_STRIPE_COLOR }}>{emptyFill()}</span>
						</text>
					}
				>
					<text wrapMode="none">
						<span style={{ fg: rightBar()?.color }}>{rightBar()?.char}</span>
						<span style={{ fg: rightLineNumColor() }}>
							{" "}
							{formatLineNum(props.row.right?.newLineNumber)}{" "}
						</span>
						<span style={{ fg: SEPARATOR_COLOR }}>│</span>
						<span> </span>
						<For each={rightTokens()}>
							{(token) => (
								<span
									style={{
										fg: token.color,
										bg: token.emphasis ? DIFF_BG.additionEmphasis : undefined,
									}}
								>
									{token.content}
								</span>
							)}
						</For>
					</text>
				</Show>
			</box>
		</box>
	)
}
