import { For, Show, createEffect, createMemo } from "solid-js"
import { useTheme } from "../../context/theme"
import {
    BINARY_PREVIEW_HEIGHT,
    buildDiffLayoutIndex,
    type DiffPosition,
    type DiffRow,
    type DiffScrollAnchor,
    type FileId,
    type FlattenedFile,
    type HunkId,
    findDiffScrollAnchorRowIndex,
    flattenToRows,
    getCurrentDiffPosition,
    getCurrentDiffScrollAnchor,
    getCurrentFileId,
    getFileScrollTailHeight,
    getLanguage,
    getLineNumWidth,
    getMaxLineNumber,
    getVisibleRange,
    highlighterReady,
    tokenVersion,
    tokenizeLineSync,
} from "../../diff"
import { prepareLineTokens, sliceTokens } from "../../diff/line-tokens"
import { buildRowWindow, lineContentLength } from "../../diff/row-window"
import { splitDisplayPath, truncatePathMiddle } from "../../utils/path-truncate"
import { type DiffFileStatus, getDiffStatusKey, getStatusColor } from "../../utils/status-colors"
import { BinaryPreview } from "../BinaryPreview"

const BAR_CHAR = "▌"
const SEPARATOR_COLOR = "#30363d"
const GAP_PATTERN_CHAR = "╱"
const GAP_PATTERN_COLOR = "#2a2a2a"
const FILE_HEADER_PREFIX = "▌ "
const RIGHT_PADDING = 0

const STAT_COLORS = {
    addition: "#3fb950",
    deletion: "#f85149",
}

interface VirtualizedUnifiedViewProps {
    files: FlattenedFile[]
    activeFileId?: FileId | null
    onHunkRowOffsets?: (offsets: Map<HunkId, number>) => void
    onFileRowOffsets?: (offsets: Map<FileId, number>) => void
    onCurrentFileChange?: (fileId: FileId | null) => void
    onCurrentPositionChange?: (position: DiffPosition | null) => void
    onCurrentScrollAnchorChange?: (anchor: DiffScrollAnchor | null) => void
    scrollAnchor?: DiffScrollAnchor | null
    onScrollAnchorRowChange?: (rowIndex: number | null) => void
    onScrollTailHeight?: (height: number) => void
    scrollTop: number
    viewportHeight: number
    leadingContentHeight: number
    viewportWidth: number
    wrapEnabled: boolean
    scrollLeft: number
}

type WrappedRow =
    | {
          type:
              | "file-header"
              | "binary-preview"
              | "binary-preview-reserved-row"
              | "gap"
              | "file-gap"
          row: DiffRow
      }
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

    // Keep horizontal offset out of the full row layout. Only the visible rows
    // need to be cropped again when scrolling sideways.
    const wrappedRows = createMemo(() => buildWrappedRows(rows(), wrapWidth(), props.wrapEnabled))

    const layoutIndex = createMemo(() =>
        buildDiffLayoutIndex(
            wrappedRows().spans,
            (wrapped) => wrapped.row.newLineNumber,
            (wrapped) => wrapped.row.oldLineNumber,
            (span) => span.height,
        ),
    )

    createEffect(() => {
        props.onHunkRowOffsets?.(layoutIndex().hunkOffsets)
        props.onFileRowOffsets?.(layoutIndex().fileOffsets)
    })

    createEffect(() => {
        props.onScrollTailHeight?.(
            getFileScrollTailHeight(
                layoutIndex(),
                props.viewportHeight,
                props.leadingContentHeight,
            ),
        )
    })

    createEffect(() => {
        const focusRow = props.scrollTop + props.viewportHeight / 2
        props.onCurrentFileChange?.(getCurrentFileId(wrappedRows(), props.scrollTop))
        props.onCurrentPositionChange?.(
            getCurrentDiffPosition(layoutIndex(), props.scrollTop, focusRow),
        )
        props.onCurrentScrollAnchorChange?.(
            getCurrentDiffScrollAnchor(layoutIndex(), props.scrollTop),
        )
    })

    createEffect(() => {
        props.onScrollAnchorRowChange?.(
            props.scrollAnchor
                ? findDiffScrollAnchorRowIndex(layoutIndex(), props.scrollAnchor)
                : null,
        )
    })

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
            {
                additions: number
                deletions: number
                prevName?: string
                type: string
                isBinary?: boolean
            }
        >()
        for (const file of filesToRender()) {
            stats.set(file.fileId, {
                additions: file.additions,
                deletions: file.deletions,
                prevName: file.prevName,
                type: file.type,
                isBinary: file.isBinary,
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
                            fileStats={fileStats()}
                            highlighterReady={highlighterReady}
                            scrollLeft={props.scrollLeft}
                            maxHeaderWidth={Math.max(1, props.viewportWidth - 2)}
                        />
                    )}
                </For>
                <box height={wrappedRows().length - visibleRange().end} flexShrink={0} />
            </Show>
        </box>
    )
}

interface VirtualizedRowProps {
    row: WrappedRow
    lineNumWidth: number
    fileStats: Map<
        FileId,
        {
            additions: number
            deletions: number
            prevName?: string
            type: string
            isBinary?: boolean
        }
    >
    highlighterReady: () => boolean
    scrollLeft: number
    maxHeaderWidth: number
}

function VirtualizedRow(props: VirtualizedRowProps) {
    const { colors, mode } = useTheme()
    const gapPatternColor = () => (mode() === "light" ? colors().border : GAP_PATTERN_COLOR)

    if (props.row.type === "file-header") {
        const stats = props.fileStats.get(props.row.row.fileId)
        const statusColor = stats
            ? getStatusColor(getDiffStatusKey(stats.type as DiffFileStatus), colors())
            : colors().brand
        const statsWidth = stats?.isBinary
            ? 6
            : (stats?.additions ? `+${stats.additions}`.length : 0) +
              (stats?.deletions ? `-${stats.deletions}`.length : 0) +
              (stats?.additions && stats?.deletions ? 1 : 0)
        const prevName = stats?.prevName ? ` ← ${stats.prevName}` : ""
        const headerMax = Math.max(
            1,
            props.maxHeaderWidth - statsWidth - FILE_HEADER_PREFIX.length - 1,
        )
        const headerText = truncatePathMiddle(`${props.row.row.content}${prevName}`, headerMax)
        const headerSegments = splitDisplayPath(headerText)
        return (
            <box
                width={props.maxHeaderWidth + 4}
                flexDirection="row"
                backgroundColor={colors().background}
                paddingRight={1}
            >
                <text fg={statusColor} flexShrink={0}>
                    {FILE_HEADER_PREFIX}
                </text>
                <box flexDirection="row" justifyContent="space-between" flexGrow={1}>
                    <text wrapMode="none" flexShrink={0}>
                        <span style={{ fg: colors().textMuted }}>{headerSegments.directory}</span>
                        <span style={{ fg: colors().text }}>{headerSegments.fileName}</span>
                        <span style={{ fg: colors().textMuted }}>{headerSegments.suffix}</span>
                    </text>
                    <text wrapMode="none" flexGrow={1} fg={colors().backgroundElement}>
                        {"─".repeat(props.maxHeaderWidth)}
                    </text>
                    <Show when={stats?.isBinary}>
                        <text wrapMode="none" flexShrink={0}>
                            <span style={{ fg: colors().textMuted }}>binary</span>
                        </text>
                    </Show>
                    <Show
                        when={
                            stats && !stats.isBinary && (stats.additions > 0 || stats.deletions > 0)
                        }
                    >
                        <text wrapMode="none" flexShrink={0}>
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

    if (props.row.type === "binary-preview") {
        return (
            <BinaryPreview
                width={props.maxHeaderWidth + 4}
                height={BINARY_PREVIEW_HEIGHT}
                path={props.row.row.fileName}
            />
        )
    }

    if (props.row.type === "binary-preview-reserved-row") {
        return <box height={0} />
    }

    if (props.row.type === "gap") {
        const gutterWidth = props.lineNumWidth + 2
        const ellipsis = "···"
        const gutterPattern = GAP_PATTERN_CHAR.repeat(Math.max(0, gutterWidth - ellipsis.length))
        const pattern = GAP_PATTERN_CHAR.repeat(Math.max(0, props.maxHeaderWidth + 4 - gutterWidth))
        return (
            <box overflow="hidden">
                <text wrapMode="none">
                    <span style={{ fg: gapPatternColor() }}>{gutterPattern}</span>
                    <span style={{ fg: colors().textMuted }}>{ellipsis}</span>
                    <span style={{ fg: gapPatternColor() }}>{pattern}</span>
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
            lineStart={contentRow.isWrapped ? contentRow.lineStart : props.scrollLeft}
            lineLength={contentRow.lineLength}
            lineNumWidth={props.lineNumWidth}
            highlighterReady={props.highlighterReady}
            isWrapped={contentRow.isWrapped}
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
}

function DiffLineRow(props: DiffLineRowProps) {
    const { colors, syntaxTheme } = useTheme()

    const language = createMemo(() => getLanguage(props.row.fileName))

    const lineBg = createMemo(() => {
        switch (props.row.type) {
            case "addition":
                return colors().diff.additionBackground
            case "deletion":
                return colors().diff.deletionBackground
            default:
                return undefined
        }
    })

    const tokens = createMemo(() => {
        tokenVersion()
        return prepareLineTokens(
            props.row.content,
            props.row.wordDiff,
            props.row.type === "deletion" ? "removed" : "added",
            colors().text,
            props.highlighterReady()
                ? (content) => tokenizeLineSync(content, language(), syntaxTheme())
                : undefined,
        )
    })

    const lineNum = createMemo(() => {
        if (props.isWrapped) return " ".repeat(props.lineNumWidth)
        const num =
            props.row.type === "deletion" ? props.row.oldLineNumber : props.row.newLineNumber
        return (num?.toString() ?? "").padStart(props.lineNumWidth, " ")
    })

    const lineNumColor = createMemo(() => {
        switch (props.row.type) {
            case "deletion":
                return colors().diff.deletionText
            case "addition":
                return colors().diff.additionText
            default:
                return colors().diff.lineNumber
        }
    })

    const bar = createMemo(() => {
        switch (props.row.type) {
            case "addition":
                return { char: BAR_CHAR, color: colors().diff.additionText }
            case "deletion":
                return { char: BAR_CHAR, color: colors().diff.deletionText }
            default:
                return { char: " ", color: undefined }
        }
    })

    return (
        <box flexDirection="row" backgroundColor={lineBg()} flexGrow={1}>
            <text wrapMode="none">
                <span style={{ fg: bar().color }}>{bar().char}</span>
                <span style={{ fg: lineNumColor() }}> {lineNum()} </span>
                <span style={{ fg: SEPARATOR_COLOR }}>│</span>
                <span> </span>
                <For each={sliceTokens(tokens(), props.lineStart, props.lineLength)}>
                    {(token) => (
                        <span
                            style={{
                                fg: token.color,
                                bg: token.emphasis
                                    ? props.row.type === "deletion"
                                        ? colors().diff.deletionEmphasisBackground
                                        : colors().diff.additionEmphasisBackground
                                    : undefined,
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

export function buildWrappedRows(rows: DiffRow[], wrapWidth: number, wrapEnabled: boolean) {
    const width = Math.max(1, wrapWidth)
    const isContent = (row: DiffRow) =>
        row.type === "context" || row.type === "addition" || row.type === "deletion"
    return buildRowWindow(
        rows,
        (row) =>
            wrapEnabled && isContent(row) ? Math.ceil(lineContentLength(row.content) / width) : 1,
        (row, wrapIndex): WrappedRow => {
            if (!isContent(row))
                return { type: row.type as Exclude<WrappedRow["type"], "content">, row }
            const start = wrapIndex * width
            return {
                type: "content",
                row,
                lineStart: start,
                lineLength: Math.min(
                    wrapEnabled ? width : width - 1,
                    Math.max(0, lineContentLength(row.content) - start),
                ),
                isWrapped: wrapIndex > 0,
            }
        },
    )
}
