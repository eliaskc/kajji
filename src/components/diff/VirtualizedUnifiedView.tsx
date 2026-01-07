import { For, Show, createMemo } from "solid-js"
import { useTheme } from "../../context/theme"
import {
	type DiffRow,
	type FileId,
	type FlattenedFile,
	type HunkId,
	type WordDiffSegment,
	computeWordDiff,
	flattenToRows,
	getFileStatusColor,
	getFileStatusIndicator,
	getLanguage,
	getLineNumWidth,
	getMaxLineNumber,
	getVisibleRange,
	tokenizeWithCache,
	type SyntaxToken,
} from "../../diff"

const DIFF_BG = {
	addition: "#0d2818",
	deletion: "#2d1215",
	additionEmphasis: "#1a5a2a",
	deletionEmphasis: "#5a1a1a",
	hunkHeader: "#161620",
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
const FILE_HEADER_BG = "#1c2128"
const HUNK_HEADER_BG = "#161b22"

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
						<VirtualizedRow
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

interface VirtualizedRowProps {
	row: DiffRow
	lineNumWidth: number
	currentHunkId?: HunkId | null
	fileStats: Map<
		FileId,
		{ additions: number; deletions: number; prevName?: string; type: string }
	>
}

function VirtualizedRow(props: VirtualizedRowProps) {
	const { colors } = useTheme()

	if (props.row.type === "file-header") {
		const stats = props.fileStats.get(props.row.fileId)
		return (
			<box backgroundColor={FILE_HEADER_BG} paddingLeft={1} paddingRight={1}>
				<text>
					<span style={{ fg: getFileStatusColor((stats?.type ?? "change") as "change" | "rename-pure" | "rename-changed" | "new" | "deleted") }}>
						{getFileStatusIndicator((stats?.type ?? "change") as "change" | "rename-pure" | "rename-changed" | "new" | "deleted")}
					</span>
					<span style={{ fg: colors().text }}> {props.row.content}</span>
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
					<span
						style={{
							fg: isCurrent ? "#58a6ff" : "#6e7681",
						}}
					>
						{props.row.content}
					</span>
				</text>
			</box>
		)
	}

	return (
		<DiffLineRow
			row={props.row}
			lineNumWidth={props.lineNumWidth}
		/>
	)
}

interface DiffLineRowProps {
	row: DiffRow
	lineNumWidth: number
}

interface TokenWithEmphasis extends SyntaxToken {
	emphasis?: boolean
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

	const tokens = createMemo((): TokenWithEmphasis[] => {
		const result = tokenizeWithCache(props.row.content, language())
		return result.map((t) => ({
			content: t.content,
			color: t.color ?? colors().text,
		}))
	})

	const lineNum = createMemo(() => {
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
		<box flexDirection="row" backgroundColor={lineBg()}>
			<text wrapMode="none">
				<span style={{ fg: bar().color }}>{bar().char}</span>
				<span style={{ fg: lineNumColor() }}> {lineNum()} </span>
				<span style={{ fg: SEPARATOR_COLOR }}>│</span>
				<span> </span>
				<For each={tokens()}>
					{(token) => (
						<span style={{ fg: token.color }}>{token.content}</span>
					)}
				</For>
			</text>
		</box>
	)
}
