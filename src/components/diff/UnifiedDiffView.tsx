import { For, Show, createMemo } from "solid-js"
import { useTheme } from "../../context/theme"
import {
	type DiffLine,
	type FileId,
	type FlattenedFile,
	type FlattenedHunk,
	type HunkId,
	type SyntaxToken,
	type WordDiffSegment,
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

interface UnifiedDiffViewProps {
	files: FlattenedFile[]
	activeFileId?: FileId | null
	currentHunkId?: HunkId | null
}

/**
 * Renders a unified diff view (single column with +/- indicators).
 * File-at-a-time: if activeFileId is set, only renders that file.
 */
export function UnifiedDiffView(props: UnifiedDiffViewProps) {
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

	return (
		<box flexDirection="column">
			<For each={filesToRender()}>
				{(file) => (
					<FileSection
						file={file}
						currentHunkId={props.currentHunkId}
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

interface FileSectionProps {
	file: FlattenedFile
	currentHunkId?: HunkId | null
	lineNumWidth: number
}

const FILE_HEADER_BG = "#1c2128"
const STAT_COLORS = {
	addition: "#3fb950",
	deletion: "#f85149",
}

function FileSection(props: FileSectionProps) {
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
					<HunkSection
						hunk={hunk}
						isCurrent={hunk.hunkId === props.currentHunkId}
						filename={props.file.name}
						lineNumWidth={props.lineNumWidth}
					/>
				)}
			</For>

			<text> </text>
		</box>
	)
}

interface HunkSectionProps {
	hunk: FlattenedHunk
	isCurrent: boolean
	filename: string
	lineNumWidth: number
}

interface LineWithWordDiff {
	line: DiffLine
	wordDiff?: WordDiffSegment[]
}

function computeWordDiffsForHunk(lines: DiffLine[]): LineWithWordDiff[] {
	const result: LineWithWordDiff[] = []
	let i = 0

	while (i < lines.length) {
		const line = lines[i]
		if (!line) {
			i++
			continue
		}

		if (line.type === "deletion") {
			const deletionStart = i
			while (i < lines.length && lines[i]?.type === "deletion") i++
			const additionStart = i
			while (i < lines.length && lines[i]?.type === "addition") i++

			const deletions = lines.slice(deletionStart, additionStart)
			const additions = lines.slice(additionStart, i)

			if (deletions.length === 1 && additions.length === 1) {
				const del = deletions[0]
				const add = additions[0]
				if (del && add) {
					const { old: oldSegs, new: newSegs } = computeWordDiff(
						del.content,
						add.content,
					)
					result.push({ line: del, wordDiff: oldSegs })
					result.push({ line: add, wordDiff: newSegs })
				}
			} else {
				for (const d of deletions) result.push({ line: d })
				for (const a of additions) result.push({ line: a })
			}
		} else {
			result.push({ line })
			i++
		}
	}

	return result
}

const HUNK_HEADER_COLORS = {
	bg: "#161b22",
	text: "#6e7681",
	textFocused: "#58a6ff",
}

function HunkSection(props: HunkSectionProps) {
	const linesWithWordDiff = createMemo(() =>
		computeWordDiffsForHunk(props.hunk.lines),
	)

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

			<For each={linesWithWordDiff()}>
				{(item) => (
					<DiffLineView
						line={item.line}
						filename={props.filename}
						wordDiff={item.wordDiff}
						lineNumWidth={props.lineNumWidth}
					/>
				)}
			</For>
		</box>
	)
}

interface DiffLineViewProps {
	line: DiffLine
	filename: string
	wordDiff?: WordDiffSegment[]
	lineNumWidth: number
}

interface TokenWithEmphasis extends SyntaxToken {
	emphasis?: boolean
}

function DiffLineView(props: DiffLineViewProps) {
	const { colors } = useTheme()

	const language = createMemo(() => getLanguage(props.filename))

	const lineBg = createMemo(() => {
		switch (props.line.type) {
			case "addition":
				return DIFF_BG.addition
			case "deletion":
				return DIFF_BG.deletion
			default:
				return undefined
		}
	})

	const emphasisBg = createMemo(() => {
		switch (props.line.type) {
			case "addition":
				return DIFF_BG.additionEmphasis
			case "deletion":
				return DIFF_BG.deletionEmphasis
			default:
				return undefined
		}
	})

	const emphasisType = createMemo(() =>
		props.line.type === "deletion" ? "removed" : "added",
	)

	const tokens = createMemo((): TokenWithEmphasis[] => {
		if (props.line.type === "hunk-header") {
			return [{ content: props.line.content, color: colors().info }]
		}

		if (!props.wordDiff) {
			const result = tokenizeLineSync(props.line.content, language())
			return result.map((t) => ({
				content: t.content,
				color: t.color ?? colors().text,
			}))
		}

		const result: TokenWithEmphasis[] = []
		for (const segment of props.wordDiff) {
			const segmentTokens = tokenizeLineSync(segment.text, language())
			const isEmphasis = segment.type === emphasisType()
			for (const token of segmentTokens) {
				result.push({
					content: token.content,
					color: token.color ?? colors().text,
					emphasis: isEmphasis,
				})
			}
		}
		return result
	})

	const lineNum = createMemo(() => {
		const num =
			props.line.type === "deletion"
				? props.line.oldLineNumber
				: props.line.newLineNumber
		return (num?.toString() ?? "").padStart(props.lineNumWidth, " ")
	})

	const lineNumColor = createMemo(() => {
		switch (props.line.type) {
			case "deletion":
				return LINE_NUM_COLORS.deletion
			case "addition":
				return LINE_NUM_COLORS.addition
			default:
				return LINE_NUM_COLORS.context
		}
	})

	const bar = createMemo(() => {
		switch (props.line.type) {
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
						<span
							style={{
								fg: token.color,
								bg: token.emphasis ? emphasisBg() : undefined,
							}}
						>
							{token.content}
						</span>
					)}
				</For>
			</text>
		</box>
	)
}
