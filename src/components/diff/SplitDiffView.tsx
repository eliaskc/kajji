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
	tokenizeLineSync,
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
const STAT_COLORS = {
	addition: "#3fb950",
	deletion: "#f85149",
}

const HUNK_HEADER_COLORS = {
	bg: "#161b22",
	text: "#6e7681",
	textFocused: "#58a6ff",
}

const BAR_CHAR = "▌"
const EMPTY_STRIPE_CHAR = "╱"
const EMPTY_STRIPE_COLOR = "#2a2a2a"

interface SplitDiffViewProps {
	files: FlattenedFile[]
	activeFileId?: FileId | null
	currentHunkId?: HunkId | null
	width: number
}

/**
 * Renders a split (side-by-side) diff view.
 * Shows old version on left, new version on right.
 */
export function SplitDiffView(props: SplitDiffViewProps) {
	const { colors } = useTheme()

	const filesToRender = createMemo(() => {
		if (props.activeFileId) {
			const file = props.files.find((f) => f.fileId === props.activeFileId)
			return file ? [file] : []
		}
		return props.files
	})

	const lineNumWidth = createMemo(() => {
		const maxLine = getMaxLineNumber(props.files)
		return Math.max(1, getLineNumWidth(maxLine))
	})

	const columnWidth = createMemo(() => Math.floor((props.width - 3) / 2))

	return (
		<box flexDirection="column">
			<For each={filesToRender()}>
				{(file) => (
					<SplitFileSection
						file={file}
						currentHunkId={props.currentHunkId}
						columnWidth={columnWidth()}
						lineNumWidth={lineNumWidth()}
					/>
				)}
			</For>
			<Show when={props.files.length === 0}>
				<text fg={colors().textMuted}>No changes</text>
			</Show>
		</box>
	)
}

interface SplitFileSectionProps {
	file: FlattenedFile
	currentHunkId?: HunkId | null
	columnWidth: number
	lineNumWidth: number
}

function SplitFileSection(props: SplitFileSectionProps) {
	const { colors } = useTheme()

	return (
		<box flexDirection="column">
			<box backgroundColor={FILE_HEADER_BG} paddingLeft={1} paddingRight={1}>
				<text>
					<span style={{ fg: getFileStatusColor(props.file.type) }}>
						{getFileStatusIndicator(props.file.type)}
					</span>
					<span style={{ fg: colors().text }}> {props.file.name}</span>
					<Show when={props.file.prevName}>
						<span style={{ fg: colors().textMuted }}>
							{" ← "}
							{props.file.prevName}
						</span>
					</Show>
					<span style={{ fg: SEPARATOR_COLOR }}> │ </span>
					<Show when={props.file.additions > 0}>
						<span style={{ fg: STAT_COLORS.addition }}>
							+{props.file.additions}
						</span>
					</Show>
					<Show when={props.file.additions > 0 && props.file.deletions > 0}>
						<span> </span>
					</Show>
					<Show when={props.file.deletions > 0}>
						<span style={{ fg: STAT_COLORS.deletion }}>
							-{props.file.deletions}
						</span>
					</Show>
				</text>
			</box>

			<For each={props.file.hunks}>
				{(hunk) => (
					<SplitHunkSection
						hunk={hunk}
						isCurrent={hunk.hunkId === props.currentHunkId}
						columnWidth={props.columnWidth}
						filename={props.file.name}
						lineNumWidth={props.lineNumWidth}
					/>
				)}
			</For>

			<text> </text>
		</box>
	)
}

interface SplitHunkSectionProps {
	hunk: FlattenedHunk
	isCurrent: boolean
	columnWidth: number
	filename: string
	lineNumWidth: number
}

function SplitHunkSection(props: SplitHunkSectionProps) {
	const alignedRows = createMemo(() => buildAlignedRows(props.hunk.lines))

	return (
		<box flexDirection="column">
			<box backgroundColor={HUNK_HEADER_COLORS.bg} paddingLeft={1}>
				<text>
					<span
						style={{
							fg: props.isCurrent
								? HUNK_HEADER_COLORS.textFocused
								: HUNK_HEADER_COLORS.text,
						}}
					>
						{props.hunk.header}
					</span>
				</text>
			</box>

			<For each={alignedRows()}>
				{(row) => (
					<SplitRowView
						row={row}
						columnWidth={props.columnWidth}
						filename={props.filename}
						lineNumWidth={props.lineNumWidth}
					/>
				)}
			</For>
		</box>
	)
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

interface SplitRowViewProps {
	row: AlignedRow
	columnWidth: number
	filename: string
	lineNumWidth: number
}

interface TokenWithEmphasis extends SyntaxToken {
	emphasis?: boolean
}

function SplitRowView(props: SplitRowViewProps) {
	const { colors } = useTheme()

	const language = createMemo(() => getLanguage(props.filename))

	const formatLineNum = (num: number | undefined) =>
		(num?.toString() ?? "").padStart(props.lineNumWidth, " ")

	const tokenizeWithWordDiff = (
		content: string,
		wordDiff: WordDiffSegment[] | undefined,
		emphasisType: "removed" | "added",
	): TokenWithEmphasis[] => {
		if (!wordDiff) {
			const tokens = tokenizeLineSync(content, language())
			return tokens.map((t) => ({
				content: t.content,
				color: t.color ?? colors().text,
			}))
		}

		const result: TokenWithEmphasis[] = []
		for (const segment of wordDiff) {
			const segmentTokens = tokenizeLineSync(segment.text, language())
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

	const emptyFill = createMemo(() => {
		return EMPTY_STRIPE_CHAR.repeat(500)
	})

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
