import { For, Show, createEffect, createMemo } from "solid-js"
import { useTheme } from "../../context/theme"
import type {
    DiffLine,
    DiffPosition,
    DiffScrollAnchor,
    FileId,
    FlattenedFile,
    HunkId,
    WordDiffSegment,
} from "../../diff"
import {
    BINARY_PREVIEW_HEIGHT,
    buildDiffLayoutIndex,
    findDiffScrollAnchorRowIndex,
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
import { createWordDiffCache } from "../../diff/word-diff"
import { splitDisplayPath, truncatePathMiddle } from "../../utils/path-truncate"
import { type DiffFileStatus, getDiffStatusKey, getStatusColor } from "../../utils/status-colors"
import { BinaryPreview } from "../BinaryPreview"

const SEPARATOR_COLOR = "#30363d"
const GAP_PATTERN_CHAR = "╱"
const GAP_PATTERN_COLOR = "#2a2a2a"
const FILE_HEADER_PREFIX = "▌ "

const STAT_COLORS = {
    addition: "#3fb950",
    deletion: "#f85149",
}

const BAR_CHAR = "▌"
const EMPTY_STRIPE_CHAR = "╱"
const EMPTY_STRIPE_COLOR = "#2a2a2a"
const RIGHT_PADDING = 0

type SplitRowType =
    | "file-header"
    | "binary-preview"
    | "binary-preview-reserved-row"
    | "file-gap"
    | "gap"
    | "content"

interface SplitRow {
    type: SplitRowType
    fileId: FileId
    hunkId: HunkId | null
    fileName: string
    left: DiffLine | null
    right: DiffLine | null
    leftWordDiff?: WordDiffSegment[]
    rightWordDiff?: WordDiffSegment[]
    textualPair?: boolean
    fullWidth?: boolean
    gapLines?: number
    rowIndex: number
}

export function flattenToSplitRows(files: FlattenedFile[]): SplitRow[] {
    const rows: SplitRow[] = []
    let rowIndex = 0

    for (const [fileIndex, file] of files.entries()) {
        const renderUnified = fileHasSingleDiffSide(file)

        rows.push({
            type: "file-header",
            fileId: file.fileId,
            hunkId: null,
            fileName: file.name,
            left: null,
            right: null,
            rowIndex: rowIndex++,
        })

        if (file.isBinary) {
            for (let row = 0; row < BINARY_PREVIEW_HEIGHT; row += 1) {
                rows.push({
                    type: row === 0 ? "binary-preview" : "binary-preview-reserved-row",
                    fileId: file.fileId,
                    hunkId: null,
                    fileName: file.name,
                    left: null,
                    right: null,
                    rowIndex: rowIndex++,
                })
            }
        }

        let prevHunk = null as FlattenedFile["hunks"][number] | null
        for (const hunk of file.hunks) {
            if (!prevHunk) {
                const gapOld = hunk.oldStart - 1
                const gapNew = hunk.newStart - 1
                const gapLines = Math.max(gapOld, gapNew)
                if (gapLines > 0) {
                    rows.push({
                        type: "gap",
                        fileId: file.fileId,
                        hunkId: null,
                        fileName: file.name,
                        left: null,
                        right: null,
                        fullWidth: renderUnified,
                        gapLines,
                        rowIndex: rowIndex++,
                    })
                }
            } else {
                const prevOldEnd = prevHunk.oldStart + prevHunk.oldLines
                const prevNewEnd = prevHunk.newStart + prevHunk.newLines
                const gapOld = hunk.oldStart - prevOldEnd
                const gapNew = hunk.newStart - prevNewEnd
                const gapLines = Math.max(gapOld, gapNew)
                if (gapLines > 0) {
                    rows.push({
                        type: "gap",
                        fileId: file.fileId,
                        hunkId: null,
                        fileName: file.name,
                        left: null,
                        right: null,
                        fullWidth: renderUnified,
                        gapLines,
                        rowIndex: rowIndex++,
                    })
                }
            }

            if (renderUnified) {
                for (const line of hunk.lines) {
                    rows.push({
                        type: "content",
                        fileId: file.fileId,
                        hunkId: hunk.hunkId,
                        fileName: file.name,
                        left: line.type === "addition" ? null : line,
                        right: line.type === "deletion" ? null : line,
                        fullWidth: true,
                        rowIndex: rowIndex++,
                    })
                }
            } else if (hunk.alignedRows) {
                // Structural engine: alignment and emphasis are precomputed.
                for (const aligned of hunk.alignedRows) {
                    rows.push({
                        type: "content",
                        fileId: file.fileId,
                        hunkId: hunk.hunkId,
                        fileName: file.name,
                        left: aligned.left,
                        right: aligned.right,
                        leftWordDiff: aligned.left?.wordDiff,
                        rightWordDiff: aligned.right?.wordDiff,
                        rowIndex: rowIndex++,
                    })
                }
            } else {
                const alignedRows = buildAlignedRows(hunk.lines)
                for (const aligned of alignedRows) {
                    rows.push({
                        type: "content",
                        fileId: file.fileId,
                        hunkId: hunk.hunkId,
                        fileName: file.name,
                        left: aligned.left,
                        right: aligned.right,
                        textualPair:
                            aligned.left?.type === "deletion" && aligned.right?.type === "addition",
                        rowIndex: rowIndex++,
                    })
                }
            }

            prevHunk = hunk
        }

        if (fileIndex < files.length - 1) {
            rows.push({
                type: "file-gap",
                fileId: file.fileId,
                hunkId: null,
                fileName: file.name,
                left: null,
                right: null,
                rowIndex: rowIndex++,
            })
        }
    }

    return rows
}

function fileHasSingleDiffSide(file: FlattenedFile): boolean {
    let hasOldSide = false
    let hasNewSide = false

    for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
            if (line.oldLineNumber !== undefined) hasOldSide = true
            if (line.newLineNumber !== undefined) hasNewSide = true
            if (hasOldSide && hasNewSide) return false
        }
    }

    return hasOldSide !== hasNewSide
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

type WrappedSplitRow =
    | {
          type:
              | "file-header"
              | "binary-preview"
              | "binary-preview-reserved-row"
              | "gap"
              | "file-gap"
          row: SplitRow
      }
    | {
          type: "content"
          layout: "split"
          row: SplitRow
          leftStart: number | null
          leftLength: number
          rightStart: number | null
          rightLength: number
          leftWrapped: boolean
          rightWrapped: boolean
      }
    | {
          type: "content"
          layout: "unified"
          row: SplitRow
          line: DiffLine
          lineStart: number
          lineLength: number
          isWrapped: boolean
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

    const wrapWidth = createMemo(() => {
        const width = Math.max(1, props.viewportWidth)
        const columnWidth = Math.max(1, Math.floor((width - 1) / 2))
        const prefixWidth = lineNumWidth() + 5
        return Math.max(1, columnWidth - prefixWidth - RIGHT_PADDING)
    })

    const unifiedWrapWidth = createMemo(() => {
        const width = Math.max(1, props.viewportWidth)
        const prefixWidth = lineNumWidth() + 5
        return Math.max(1, width - prefixWidth - RIGHT_PADDING)
    })

    const columnWidth = createMemo(() => {
        const width = Math.max(1, props.viewportWidth)
        return Math.max(1, Math.floor((width - 1) / 2))
    })

    // Keep horizontal offset out of the full row layout. Only the visible rows
    // need to be cropped again when scrolling sideways.
    const wordDiff = createWordDiffCache()
    const wrappedRows = createMemo(() =>
        buildWrappedSplitRows(rows(), wrapWidth(), unifiedWrapWidth(), props.wrapEnabled, wordDiff),
    )

    const layoutIndex = createMemo(() =>
        buildDiffLayoutIndex(
            wrappedRows().spans,
            (wrapped) => wrapped.row.right?.newLineNumber ?? wrapped.row.left?.newLineNumber,
            (wrapped) => wrapped.row.left?.oldLineNumber ?? wrapped.row.right?.oldLineNumber,
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
                        <VirtualizedSplitRow
                            row={row}
                            lineNumWidth={lineNumWidth()}
                            fileStats={fileStats()}
                            highlighterReady={highlighterReady}
                            scrollLeft={props.scrollLeft}
                            columnWidth={columnWidth()}
                            maxHeaderWidth={Math.max(1, props.viewportWidth - 2)}
                        />
                    )}
                </For>
                <box height={wrappedRows().length - visibleRange().end} flexShrink={0} />
            </Show>
        </box>
    )
}

interface VirtualizedSplitRowProps {
    row: WrappedSplitRow
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
    columnWidth: number
    maxHeaderWidth: number
}

function VirtualizedSplitRow(props: VirtualizedSplitRowProps) {
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
        const headerText = truncatePathMiddle(`${props.row.row.fileName}${prevName}`, headerMax)
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
        const totalWidth = props.maxHeaderWidth + 4
        const pattern = GAP_PATTERN_CHAR.repeat(Math.max(0, totalWidth - gutterWidth))
        const leftPattern = GAP_PATTERN_CHAR.repeat(
            Math.max(0, props.columnWidth - gutterWidth + 2),
        )
        const rightPattern = GAP_PATTERN_CHAR.repeat(
            Math.max(0, totalWidth - props.columnWidth - gutterWidth - 2),
        )
        const gapMarker = () => (
            <>
                <span style={{ fg: gapPatternColor() }}>{gutterPattern}</span>
                <span style={{ fg: colors().textMuted }}>{ellipsis}</span>
            </>
        )
        return (
            <box overflow="hidden">
                <text wrapMode="none">
                    {gapMarker()}
                    <Show when={!props.row.row.fullWidth}>
                        <span style={{ fg: gapPatternColor() }}>{leftPattern}</span>
                        {gapMarker()}
                    </Show>
                    <span style={{ fg: gapPatternColor() }}>
                        {props.row.row.fullWidth ? pattern : rightPattern}
                    </span>
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

    if (props.row.layout === "unified") {
        return (
            <UnifiedContentRow
                row={props.row}
                lineNumWidth={props.lineNumWidth}
                highlighterReady={props.highlighterReady}
                scrollLeft={props.scrollLeft}
            />
        )
    }

    return (
        <SplitContentRow
            row={props.row}
            lineNumWidth={props.lineNumWidth}
            highlighterReady={props.highlighterReady}
            scrollLeft={props.scrollLeft}
            columnWidth={props.columnWidth}
        />
    )
}

interface SplitContentRowProps {
    row: Extract<WrappedSplitRow, { type: "content"; layout: "split" }>
    lineNumWidth: number
    highlighterReady: () => boolean
    scrollLeft: number
    columnWidth: number
}

function SplitContentRow(props: SplitContentRowProps) {
    const { colors, mode, syntaxTheme } = useTheme()

    const language = createMemo(() => getLanguage(props.row.row.fileName))

    const formatLineNum = (num: number | undefined) =>
        (num?.toString() ?? "").padStart(props.lineNumWidth, " ")

    const hasLeftLine = createMemo(() => props.row.leftStart !== null && props.row.row.left)
    const hasRightLine = createMemo(() => props.row.rightStart !== null && props.row.row.right)

    const leftBg = createMemo(() => {
        if (!hasLeftLine()) return undefined
        return props.row.row.left?.type === "deletion"
            ? colors().diff.deletionBackground
            : undefined
    })

    const rightBg = createMemo(() => {
        if (!hasRightLine()) return undefined
        return props.row.row.right?.type === "addition"
            ? colors().diff.additionBackground
            : undefined
    })

    const tokensForSide = (side: "left" | "right") => {
        tokenVersion()
        if (side === "left" ? !hasLeftLine() : !hasRightLine()) return []
        return prepareLineTokens(
            props.row.row[side]?.content ?? "",
            side === "left" ? props.row.row.leftWordDiff : props.row.row.rightWordDiff,
            side === "left" ? "removed" : "added",
            colors().text,
            props.highlighterReady()
                ? (content) => tokenizeLineSync(content, language(), syntaxTheme())
                : undefined,
        )
    }
    const leftTokens = createMemo(() => tokensForSide("left"))
    const rightTokens = createMemo(() => tokensForSide("right"))

    const leftLineNumColor = createMemo(() => {
        if (!hasLeftLine()) return colors().diff.lineNumber
        return props.row.row.left?.type === "deletion"
            ? colors().diff.deletionText
            : colors().diff.lineNumber
    })

    const rightLineNumColor = createMemo(() => {
        if (!hasRightLine()) return colors().diff.lineNumber
        return props.row.row.right?.type === "addition"
            ? colors().diff.additionText
            : colors().diff.lineNumber
    })

    const leftBar = createMemo(() => {
        if (!hasLeftLine()) return null
        if (props.row.row.left?.type === "deletion")
            return { char: BAR_CHAR, color: colors().diff.deletionText }
        return { char: " ", color: undefined }
    })

    const rightBar = createMemo(() => {
        if (!hasRightLine()) return null
        if (props.row.row.right?.type === "addition")
            return { char: BAR_CHAR, color: colors().diff.additionText }
        return { char: " ", color: undefined }
    })

    const leftLineNum = createMemo(() =>
        props.row.leftWrapped ? undefined : props.row.row.left?.oldLineNumber,
    )

    const rightLineNum = createMemo(() =>
        props.row.rightWrapped ? undefined : props.row.row.right?.newLineNumber,
    )

    const emptyFill = createMemo(() => EMPTY_STRIPE_CHAR.repeat(props.columnWidth))
    const emptyStripeColor = () => (mode() === "light" ? colors().border : EMPTY_STRIPE_COLOR)

    return (
        <box flexDirection="row">
            <box backgroundColor={leftBg()} flexGrow={1} flexBasis={0} overflow="hidden">
                <Show
                    when={hasLeftLine()}
                    fallback={
                        <text wrapMode="none">
                            <span style={{ fg: emptyStripeColor() }}>{emptyFill()}</span>
                        </text>
                    }
                >
                    <text wrapMode="none">
                        <span style={{ fg: leftBar()?.color }}>{leftBar()?.char}</span>
                        <span style={{ fg: leftLineNumColor() }}>
                            {" "}
                            {formatLineNum(leftLineNum())}{" "}
                        </span>
                        <span style={{ fg: SEPARATOR_COLOR }}>│</span>
                        <span> </span>
                        <For
                            each={sliceTokens(
                                leftTokens(),
                                props.row.leftWrapped
                                    ? (props.row.leftStart ?? 0)
                                    : props.scrollLeft,
                                props.row.leftLength,
                            )}
                        >
                            {(token) => (
                                <span
                                    style={{
                                        fg: token.color,
                                        bg: token.emphasis
                                            ? colors().diff.deletionEmphasisBackground
                                            : undefined,
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
            <box backgroundColor={rightBg()} flexGrow={1} flexBasis={0} overflow="hidden">
                <Show
                    when={hasRightLine()}
                    fallback={
                        <text wrapMode="none">
                            <span style={{ fg: emptyStripeColor() }}>{emptyFill()}</span>
                        </text>
                    }
                >
                    <text wrapMode="none">
                        <span style={{ fg: rightBar()?.color }}>{rightBar()?.char}</span>
                        <span style={{ fg: rightLineNumColor() }}>
                            {" "}
                            {formatLineNum(rightLineNum())}{" "}
                        </span>
                        <span style={{ fg: SEPARATOR_COLOR }}>│</span>
                        <span> </span>
                        <For
                            each={sliceTokens(
                                rightTokens(),
                                props.row.rightWrapped
                                    ? (props.row.rightStart ?? 0)
                                    : props.scrollLeft,
                                props.row.rightLength,
                            )}
                        >
                            {(token) => (
                                <span
                                    style={{
                                        fg: token.color,
                                        bg: token.emphasis
                                            ? colors().diff.additionEmphasisBackground
                                            : undefined,
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

interface UnifiedContentRowProps {
    row: Extract<WrappedSplitRow, { type: "content"; layout: "unified" }>
    lineNumWidth: number
    highlighterReady: () => boolean
    scrollLeft: number
}

function UnifiedContentRow(props: UnifiedContentRowProps) {
    const { colors, syntaxTheme } = useTheme()

    const language = createMemo(() => getLanguage(props.row.row.fileName))

    const lineBg = createMemo(() => {
        switch (props.row.line.type) {
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
            props.row.line.content,
            props.row.line.wordDiff,
            props.row.line.type === "deletion" ? "removed" : "added",
            colors().text,
            props.highlighterReady()
                ? (content) => tokenizeLineSync(content, language(), syntaxTheme())
                : undefined,
        )
    })

    const lineNum = createMemo(() => {
        if (props.row.isWrapped) return " ".repeat(props.lineNumWidth)
        const num =
            props.row.line.type === "deletion"
                ? props.row.line.oldLineNumber
                : props.row.line.newLineNumber
        return (num?.toString() ?? "").padStart(props.lineNumWidth, " ")
    })

    const lineNumColor = createMemo(() => {
        switch (props.row.line.type) {
            case "deletion":
                return colors().diff.deletionText
            case "addition":
                return colors().diff.additionText
            default:
                return colors().diff.lineNumber
        }
    })

    const bar = createMemo(() => {
        switch (props.row.line.type) {
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
                <For
                    each={sliceTokens(
                        tokens(),
                        props.row.isWrapped ? props.row.lineStart : props.scrollLeft,
                        props.row.lineLength,
                    )}
                >
                    {(token) => (
                        <span
                            style={{
                                fg: token.color,
                                bg: token.emphasis
                                    ? props.row.line.type === "deletion"
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

export function buildWrappedSplitRows(
    rows: SplitRow[],
    wrapWidth: number,
    unifiedWrapWidth: number,
    wrapEnabled: boolean,
    wordDiff = createWordDiffCache(),
) {
    const width = Math.max(1, wrapWidth)
    const fullWidth = Math.max(1, unifiedWrapWidth)
    const count = (line: DiffLine | null, width: number) =>
        Math.max(1, Math.ceil(lineContentLength(line?.content ?? "") / width))

    return buildRowWindow(
        rows,
        (row) => {
            if (!wrapEnabled || row.type !== "content") return 1
            if (row.fullWidth) return count(row.left ?? row.right, fullWidth)
            return Math.max(count(row.left, width), count(row.right, width))
        },
        (source, wrapIndex): WrappedSplitRow => {
            if (source.type !== "content") return { type: source.type, row: source }
            let row = source
            // Structural alignment/emphasis takes precedence over textual pairing.
            if (row.textualPair && row.left && row.right) {
                const emphasis = wordDiff.get(row.left.content, row.right.content)
                row = { ...row, leftWordDiff: emphasis.old, rightWordDiff: emphasis.new }
            }
            if (row.fullWidth) {
                const line = (row.left ?? row.right)!
                const start = wrapIndex * fullWidth
                return {
                    type: "content",
                    layout: "unified",
                    row,
                    line,
                    lineStart: start,
                    lineLength: Math.min(
                        wrapEnabled ? fullWidth : fullWidth - 1,
                        Math.max(0, lineContentLength(line.content) - start),
                    ),
                    isWrapped: wrapIndex > 0,
                }
            }
            const leftStart =
                row.left && wrapIndex < count(row.left, width) ? wrapIndex * width : null
            const rightStart =
                row.right && wrapIndex < count(row.right, width) ? wrapIndex * width : null
            const segmentLength = (line: DiffLine | null, start: number | null) =>
                start === null
                    ? 0
                    : Math.min(
                          wrapEnabled ? width : width - 1,
                          Math.max(0, lineContentLength(line?.content ?? "") - start),
                      )
            return {
                type: "content",
                layout: "split",
                row,
                leftStart,
                leftLength: segmentLength(row.left, leftStart),
                rightStart,
                rightLength: segmentLength(row.right, rightStart),
                leftWrapped: leftStart !== null && wrapIndex > 0,
                rightWrapped: rightStart !== null && wrapIndex > 0,
            }
        },
    )
}
