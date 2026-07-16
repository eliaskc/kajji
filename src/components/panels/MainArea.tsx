import { basename, resolve } from "node:path"
import type {
    BoxRenderable,
    MouseEvent,
    ScrollBoxRenderable,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
    For,
    Show,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
} from "solid-js"

import type { DiffStats } from "../../commander/operations"
import { type Commit, getRevisionId } from "../../commander/types"
import { onConfigChange, readConfig } from "../../config"
import { useApplication } from "../../context/application"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useFocus } from "../../context/focus"
import { useLayout } from "../../context/layout"
import { useStatus } from "../../context/status"
import { type CommitDetails, type ViewMode, useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import {
    type DiffPosition,
    type FileId,
    type FlattenedFile,
    type HunkId,
    flattenDiff,
    getAdjacentHunkFromRow,
    getLineNumWidth,
    getMaxLineNumber,
    parseDiffString,
} from "../../diff"
import { getRepoPath } from "../../repo"
import { stripAnsi } from "../../utils/ansi"
import { openInEditor, shouldSuspendForEditor } from "../../utils/editor"
import { orderFilesByPath } from "../../utils/file-tree"
import { getFilesLayoutWeights } from "../../utils/layout"
import { truncatePathMiddle } from "../../utils/path-truncate"
import { AnsiText } from "../AnsiText"
import { BinaryGroupFooter } from "../BinaryGroupFooter"
import { EmptyDiffState } from "../EmptyDiffState"
import { Panel } from "../Panel"
import { BookmarkDiffHeader, stripEmailAndDate } from "../RevisionHeader"
import { VirtualizedSplitView, VirtualizedUnifiedView } from "../diff"
import { DiffFileHeader } from "../diff/DiffFileHeader"

type DiffViewStyle = "unified" | "split"

import { profileLog, profileMemory } from "../../utils/profiler"

const UNIFIED_RIGHT_PADDING = 0
const SPLIT_RIGHT_PADDING = 0
const SCROLLBAR_GUTTER = 1
const HORIZONTAL_SCROLL_STEP = 5

// Mirrors OpenTUI's MacOSScrollAccel defaults. We keep this local because
// @opentui/core does not export the acceleration helper through its package
// exports in our version.
class MacOSLikeScrollAccel {
    private lastTickTime = 0
    private velocityHistory: number[] = []
    private readonly historySize = 3
    private readonly streakTimeout = 150
    private readonly minTickInterval = 6
    private readonly curveA = 0.8
    private readonly curveTau = 3
    private readonly maxMultiplier = 6
    private readonly referenceInterval = 100

    tick(now = Date.now()): number {
        if (this.lastTickTime === 0) {
            this.lastTickTime = now
            return 1
        }

        const interval = now - this.lastTickTime
        this.lastTickTime = now
        if (interval > this.streakTimeout) {
            this.velocityHistory = []
            return 1
        }
        if (interval < this.minTickInterval) return 1

        this.velocityHistory.push(interval)
        if (this.velocityHistory.length > this.historySize) {
            this.velocityHistory.shift()
        }

        const averageInterval =
            this.velocityHistory.reduce((sum, value) => sum + value, 0) /
            this.velocityHistory.length
        const velocity = this.referenceInterval / averageInterval
        const x = velocity / this.curveTau
        const multiplier = 1 + this.curveA * (Math.exp(x) - 1)
        return Math.min(multiplier, this.maxMultiplier)
    }

    reset(): void {
        this.lastTickTime = 0
        this.velocityHistory = []
    }
}

let sessionViewStyleOverride: DiffViewStyle | null = null
let sessionWrapOverride: boolean | null = null
let sessionUseJjFormatterOverride: boolean | null = null

function FileStats(props: { stats: DiffStats; maxWidth: number }) {
    const { colors } = useTheme()
    const s = () => props.stats

    const separatorWidth = 3 // " | "
    const barMargin = 2 // margin on right side

    const fileRows = createMemo(() => {
        const maxPathWidth = Math.max(1, Math.floor(props.maxWidth * 0.75))
        let maxLen = 1
        const rows = s().files.map((file) => {
            const pathText = truncatePathMiddle(file.path, maxPathWidth)
            maxLen = Math.max(maxLen, pathText.length)
            return { file, pathText }
        })
        const pathColumnWidth = Math.min(maxPathWidth, maxLen)
        const availableBarWidth = Math.max(
            1,
            props.maxWidth - pathColumnWidth - separatorWidth - barMargin,
        )
        return { rows, pathColumnWidth, availableBarWidth }
    })

    const rows = () => fileRows().rows
    const pathColumnWidth = () => fileRows().pathColumnWidth
    const availableBarWidth = () => fileRows().availableBarWidth

    // Scale +/- counts to fit within available width while preserving ratio
    const scaleBar = (
        insertions: number,
        deletions: number,
        availableWidth: number,
    ) => {
        const total = insertions + deletions
        if (total === 0) return { plus: 0, minus: 0 }
        if (total <= availableWidth)
            return { plus: insertions, minus: deletions }

        // Scale down proportionally
        const scale = availableWidth / total
        const scaledPlus = Math.round(insertions * scale)
        const scaledMinus = Math.round(deletions * scale)

        // Ensure at least 1 char if there were any changes
        const plus = insertions > 0 ? Math.max(1, scaledPlus) : 0
        const minus = deletions > 0 ? Math.max(1, scaledMinus) : 0

        return { plus, minus }
    }

    return (
        <>
            <text> </text>
            <For each={rows()}>
                {(row) => {
                    const fileNameStart = row.pathText.lastIndexOf("/") + 1
                    const pathPadding = " ".repeat(
                        Math.max(0, pathColumnWidth() - row.pathText.length),
                    )
                    const bar = scaleBar(
                        row.file.insertions,
                        row.file.deletions,
                        availableBarWidth(),
                    )
                    return (
                        <text wrapMode="none">
                            <span style={{ fg: colors().textMuted }}>
                                {row.pathText.slice(0, fileNameStart)}
                            </span>
                            <span style={{ fg: colors().text }}>
                                {row.pathText.slice(fileNameStart)}
                            </span>
                            <span style={{ fg: colors().textMuted }}>
                                {pathPadding}
                            </span>
                            {" | "}
                            <span style={{ fg: colors().success }}>
                                {"+".repeat(bar.plus)}
                            </span>
                            <span style={{ fg: colors().error }}>
                                {"-".repeat(bar.minus)}
                            </span>
                        </text>
                    )
                }}
            </For>
            <text>
                <span style={{ fg: colors().text }}>
                    {s().totalFiles} file{s().totalFiles !== 1 ? "s" : ""}{" "}
                    changed
                </span>
                <Show when={s().totalInsertions > 0}>
                    <span style={{ fg: colors().text }}>{", "}</span>
                    <span style={{ fg: colors().success }}>
                        {s().totalInsertions} insertion
                        {s().totalInsertions !== 1 ? "s" : ""}(+)
                    </span>
                </Show>
                <Show when={s().totalDeletions > 0}>
                    <span style={{ fg: colors().text }}>{", "}</span>
                    <span style={{ fg: colors().error }}>
                        {s().totalDeletions} deletion
                        {s().totalDeletions !== 1 ? "s" : ""}(-)
                    </span>
                </Show>
            </text>
            <text fg={colors().textMuted}>
                {"─".repeat(props.maxWidth + 2)}
            </text>
        </>
    )
}

function CommitHeader(props: {
    commit: Commit
    details: CommitDetails | null
    stats: DiffStats | null
    maxWidth: number
}) {
    const { colors } = useTheme()

    const subject = () => props.details?.subject || props.commit.description

    const bodyLines = createMemo(() => {
        const b = props.details?.body
        return b ? b.split("\n") : null
    })

    const cleanRefLine = () =>
        stripEmailAndDate(
            props.commit.refLine,
            props.commit.authorEmail,
            props.commit.timestamp,
        )

    return (
        <box flexDirection="column" flexShrink={0}>
            <AnsiText content={cleanRefLine()} wrapMode="none" />
            <text>
                <span style={{ fg: colors().textMuted }}>{"Author: "}</span>
                <span style={{ fg: colors().secondary }}>
                    {`${props.commit.author} <${props.commit.authorEmail}>`}
                </span>
            </text>
            <text>
                <span style={{ fg: colors().textMuted }}>{"Date:   "}</span>
                <span style={{ fg: colors().secondary }}>
                    {props.commit.timestamp}
                </span>
            </text>
            <text> </text>
            <box flexDirection="row">
                <text>{"    "}</text>
                <AnsiText content={subject()} wrapMode="none" />
            </box>
            <Show when={bodyLines()}>
                {(lines: () => string[]) => (
                    <box flexDirection="column">
                        <text> </text>
                        <For each={lines()}>
                            {(line) => (
                                <text fg={colors().text}>
                                    {"    "}
                                    {line}
                                </text>
                            )}
                        </For>
                    </box>
                )}
            </Show>
            <Show
                when={
                    props.stats && props.stats.totalFiles > 0
                        ? props.stats
                        : undefined
                }
            >
                {(stats: () => DiffStats) => (
                    <box flexDirection="column">
                        <FileStats stats={stats()} maxWidth={props.maxWidth} />
                    </box>
                )}
            </Show>
        </box>
    )
}

export function MainArea() {
    const app = useApplication()
    const {
        activeCommit,
        activeBookmarkDiff,
        commitDetails,
        viewMode,
        fileNavigationRequest,
        setCurrentDiffFilePath,
        showTree,
        refresh,
        flatFiles,
        selectedFile,
    } = useSync()
    const layout = useLayout()
    const { mainAreaWidth, terminalWidth } = layout
    const effectiveMainAreaWidth = () => {
        if (viewMode() !== "files") return mainAreaWidth()
        const weights = getFilesLayoutWeights(terminalWidth())
        const ratio = weights.detail / (weights.files + weights.detail)
        return Math.floor(terminalWidth() * ratio) - 2
    }
    const { colors } = useTheme()
    const focus = useFocus()
    const command = useCommand()
    const commandLog = useCommandLog()
    const renderer = useRenderer()
    const status = useStatus()

    let scrollRef: ScrollBoxRenderable | undefined
    let headerRef: BoxRenderable | undefined

    const [scrollTop, setScrollTop] = createSignal(0)
    const [viewportHeight, setViewportHeight] = createSignal(30)
    const [viewportWidth, setViewportWidth] = createSignal(80)
    const [metricsMode, setMetricsMode] = createSignal<ViewMode | null>(null)
    const [metricsSourceKey, setMetricsSourceKey] = createSignal<string | null>(
        null,
    )
    const [scrollLeft, setScrollLeft] = createSignal(0)
    const [headerHeight, setHeaderHeight] = createSignal(0)
    const [currentCommitId, setCurrentCommitId] = createSignal<string | null>(
        null,
    )

    const [viewStyle, setViewStyle] = createSignal<DiffViewStyle>("unified")
    const [wrapEnabled, setWrapEnabled] = createSignal(true)
    const [diffLayout, setDiffLayout] = createSignal(readConfig().diff.layout)
    const [diffAutoSwitchWidth, setDiffAutoSwitchWidth] = createSignal(
        readConfig().diff.autoSwitchWidth,
    )
    const [diffWrap, setDiffWrap] = createSignal(readConfig().diff.wrap)
    const [diffUseJjFormatter, setDiffUseJjFormatter] = createSignal(
        readConfig().diff.useJjFormatter,
    )
    const [useJjFormatterOverride, setUseJjFormatterOverride] = createSignal<
        boolean | null
    >(sessionUseJjFormatterOverride)
    const [viewStyleOverride, setViewStyleOverride] =
        createSignal<DiffViewStyle | null>(sessionViewStyleOverride)
    const [wrapOverride, setWrapOverride] = createSignal<boolean | null>(
        sessionWrapOverride,
    )
    const useJjFormatter = createMemo(
        () => useJjFormatterOverride() ?? diffUseJjFormatter(),
    )

    createEffect(() => {
        sessionUseJjFormatterOverride = useJjFormatterOverride()
    })

    createEffect(() => {
        sessionViewStyleOverride = viewStyleOverride()
    })

    createEffect(() => {
        sessionWrapOverride = wrapOverride()
    })

    const configuredViewStyle = createMemo<DiffViewStyle>(() => {
        const layout = diffLayout()
        if (layout === "unified" || layout === "split") return layout
        return effectiveMainAreaWidth() >= diffAutoSwitchWidth()
            ? "split"
            : "unified"
    })

    createEffect(() => {
        const styleOverride = viewStyleOverride()
        if (styleOverride !== null) {
            setViewStyle(styleOverride)
            return
        }
        setViewStyle(configuredViewStyle())
    })

    createEffect(() => {
        if (useJjFormatter()) {
            setWrapEnabled(false)
            return
        }
        const wrap = wrapOverride() ?? diffWrap()
        setWrapEnabled(wrap)
    })

    createEffect(() => {
        if (!focus.isPanel("detail")) return
        focus.setActiveContext(
            useJjFormatter()
                ? "detail.diff_jj_formatter"
                : "detail.diff_custom",
        )
    })
    const [parsedFiles, setParsedFiles] = createSignal<FlattenedFile[]>([])
    const [rawDiffOutput, setRawDiffOutput] = createSignal("")
    const [parsedDiffLoading, setParsedDiffLoading] = createSignal(false)
    const [parsedDiffError, setParsedDiffError] = createSignal<string | null>(
        null,
    )
    const [currentFileId, setCurrentFileId] = createSignal<FileId | null>(null)
    const [currentDiffPosition, setCurrentDiffPosition] =
        createSignal<DiffPosition | null>(null)

    const orderedFiles = createMemo(() =>
        orderFilesByPath(parsedFiles(), (file) => file.name, showTree()),
    )

    const textFiles = createMemo(() =>
        orderedFiles().filter((file) => !file.isBinary),
    )

    const binaryPaths = createMemo(() =>
        orderedFiles()
            .filter((file) => file.isBinary)
            .map((file) => file.name),
    )

    const repoInfo = createMemo(() => {
        activeCommit()
        activeBookmarkDiff()
        const repoPath = getRepoPath()
        const repoName = basename(repoPath)
        return {
            repoName,
        }
    })

    const renderRepoInfo = () => (
        <text fg={isFocused() ? colors().borderFocused : colors().textMuted}>
            {repoInfo().repoName}
        </text>
    )

    // Derived state
    const currentFile = createMemo(() =>
        textFiles().find((file) => file.fileId === currentFileId()),
    )

    const [hunkRowOffsets, setHunkRowOffsets] = createSignal(
        new Map<HunkId, number>(),
    )
    const [fileRowOffsets, setFileRowOffsets] = createSignal(
        new Map<FileId, number>(),
    )
    const [scrollTailHeight, setScrollTailHeight] = createSignal(0)
    let hunkNavigationTarget: HunkId | null = null

    const diffStats = createMemo((): DiffStats | null => {
        const files = orderedFiles()
        if (files.length === 0) return null

        const fileStats: DiffStats["files"] = []
        let totalInsertions = 0
        let totalDeletions = 0

        for (const file of files) {
            fileStats.push({
                path: file.name,
                insertions: file.additions,
                deletions: file.deletions,
            })
            totalInsertions += file.additions
            totalDeletions += file.deletions
        }

        return {
            files: fileStats,
            totalFiles: files.length,
            totalInsertions,
            totalDeletions,
        }
    })

    const maxLineLengths = createMemo(() => {
        if (useJjFormatter()) {
            return { maxUnified: 0, maxLeft: 0, maxRight: 0, maxOneSided: 0 }
        }

        let maxUnified = 0
        let maxLeft = 0
        let maxRight = 0
        let maxOneSided = 0
        for (const file of orderedFiles()) {
            let fileHasOldSide = false
            let fileHasNewSide = false
            let fileMax = 0
            let fileMaxLeft = 0
            let fileMaxRight = 0

            for (const hunk of file.hunks) {
                for (const line of hunk.lines) {
                    const length = line.content.replace(/\n$/, "").length
                    if (length > maxUnified) maxUnified = length
                    if (length > fileMax) fileMax = length
                    if (line.oldLineNumber !== undefined) fileHasOldSide = true
                    if (line.newLineNumber !== undefined) fileHasNewSide = true
                    switch (line.type) {
                        case "context":
                            if (length > fileMaxLeft) fileMaxLeft = length
                            if (length > fileMaxRight) fileMaxRight = length
                            break
                        case "deletion":
                            if (length > fileMaxLeft) fileMaxLeft = length
                            break
                        case "addition":
                            if (length > fileMaxRight) fileMaxRight = length
                            break
                    }
                }
            }

            if (fileHasOldSide !== fileHasNewSide) {
                if (fileMax > maxOneSided) maxOneSided = fileMax
            } else {
                if (fileMaxLeft > maxLeft) maxLeft = fileMaxLeft
                if (fileMaxRight > maxRight) maxRight = fileMaxRight
            }
        }
        return { maxUnified, maxLeft, maxRight, maxOneSided }
    })

    const rawMaxLineLength = createMemo(() => {
        if (!useJjFormatter()) return 0
        let maxLength = 0
        for (const line of rawDiffOutput().split("\n")) {
            const length = line.length
            if (length > maxLength) {
                maxLength = length
            }
        }
        return maxLength
    })

    const lineNumWidth = createMemo(() => {
        const maxLine = getMaxLineNumber(orderedFiles())
        return Math.max(1, getLineNumWidth(maxLine))
    })

    const diffContentWidth = createMemo(() => {
        const width = Math.max(1, viewportWidth())
        const rightPadding =
            viewStyle() === "split"
                ? SPLIT_RIGHT_PADDING
                : UNIFIED_RIGHT_PADDING
        const prefixWidth = lineNumWidth() + 5 + rightPadding
        if (viewStyle() === "split") {
            const columnWidth = Math.max(1, Math.floor((width - 1) / 2))
            return Math.max(1, columnWidth - prefixWidth)
        }
        return Math.max(1, width - prefixWidth)
    })

    const maxScrollableWidth = createMemo(() => {
        if (useJjFormatter()) {
            return rawMaxLineLength()
        }
        if (viewStyle() === "split") {
            const { maxLeft, maxRight } = maxLineLengths()
            return Math.max(maxLeft, maxRight)
        }
        return maxLineLengths().maxUnified
    })

    const maxScrollLeft = createMemo(() => {
        if (wrapEnabled()) return 0
        if (!useJjFormatter() && viewStyle() === "split") {
            const width = Math.max(1, viewportWidth())
            const prefixWidth = lineNumWidth() + 5 + SPLIT_RIGHT_PADDING
            const columnWidth = Math.max(1, Math.floor((width - 1) / 2))
            const splitContentWidth = Math.max(1, columnWidth - prefixWidth)
            const unifiedContentWidth = Math.max(1, width - prefixWidth)
            const { maxLeft, maxRight, maxOneSided } = maxLineLengths()
            return Math.max(
                0,
                Math.max(maxLeft, maxRight) - splitContentWidth,
                maxOneSided - unifiedContentWidth,
            )
        }
        return Math.max(0, maxScrollableWidth() - diffContentWidth())
    })

    const setScrollLeftClamped = (value: number) => {
        const next = Math.max(0, Math.min(value, maxScrollLeft()))
        if (next !== scrollLeft()) setScrollLeft(next)
    }

    const horizontalScrollAccel = new MacOSLikeScrollAccel()
    let horizontalScrollAccumulator = 0

    const resetHorizontalScrollState = () => {
        horizontalScrollAccel.reset()
        horizontalScrollAccumulator = 0
    }

    const handleHorizontalScroll = (event: MouseEvent) => {
        if (!event.scroll || wrapEnabled()) {
            resetHorizontalScrollState()
            return
        }

        let direction = event.scroll.direction
        if (event.modifiers.shift) {
            direction =
                direction === "up"
                    ? "left"
                    : direction === "down"
                      ? "right"
                      : direction === "right"
                        ? "down"
                        : "up"
        }
        if (direction !== "left" && direction !== "right") return

        const baseDelta = event.scroll.delta || 1
        const scrollAmount = baseDelta * horizontalScrollAccel.tick()
        horizontalScrollAccumulator +=
            direction === "left" ? -scrollAmount : scrollAmount
        const integerScroll = Math.trunc(horizontalScrollAccumulator)
        if (integerScroll !== 0) {
            setScrollLeftClamped(scrollLeft() + integerScroll)
            horizontalScrollAccumulator -= integerScroll
        }
        event.preventDefault()
        event.stopPropagation()
    }

    // Navigation functions
    const navigateFile = (direction: 1 | -1) => {
        hunkNavigationTarget = null
        const files = textFiles()
        if (files.length === 0) return
        const currentIndex = Math.max(
            0,
            files.findIndex((file) => file.fileId === currentFileId()),
        )
        const newIdx = Math.max(
            0,
            Math.min(files.length - 1, currentIndex + direction),
        )
        const targetFile = files[newIdx]
        if (!targetFile) return
        const rowOffset = fileRowOffsets().get(targetFile.fileId)
        if (rowOffset === undefined) return
        const targetScrollTop = headerHeight() + rowOffset
        scrollRef?.scrollTo(targetScrollTop)
        setScrollTop(targetScrollTop)
    }

    const navigateHunk = (direction: 1 | -1) => {
        const files = textFiles()
        const visibleRow =
            (hunkNavigationTarget
                ? hunkRowOffsets().get(hunkNavigationTarget)
                : undefined) ?? adjustedScrollTop()
        const target = getAdjacentHunkFromRow(
            files,
            hunkRowOffsets(),
            visibleRow,
            direction,
        )
        if (!target) return

        const rowOffset = hunkRowOffsets().get(target.hunkId)
        if (rowOffset === undefined) return
        hunkNavigationTarget = target.hunkId
        const targetScrollTop = headerHeight() + rowOffset
        scrollRef?.scrollTo(targetScrollTop)
        setScrollTop(targetScrollTop)
    }

    // Track current fetch to prevent stale updates
    let currentFetchKey: string | null = null

    // Fetch parsed diff when commit/file changes
    createEffect(() => {
        const commit = activeCommit()
        const bookmarkDiff = activeBookmarkDiff()
        viewMode()
        const showJjFormatter = useJjFormatter()
        if (!commit && !bookmarkDiff) return

        const paths: string[] | undefined = undefined

        const sourceKey = bookmarkDiff
            ? `${bookmarkDiff.from}..${bookmarkDiff.to}`
            : commit
              ? `${commit.changeId}:${commit.commitId}`
              : "none"
        const fetchKey = `${sourceKey}:all:${showJjFormatter ? "jj" : "custom"}`
        if (fetchKey === currentFetchKey) return
        currentFetchKey = fetchKey

        setParsedDiffLoading(true)
        setParsedDiffError(null)

        const fetchStart = performance.now()
        const diffOptions = {
            cwd: getRepoPath(),
            paths,
            color: showJjFormatter,
            columns: showJjFormatter ? Math.max(1, viewportWidth()) : undefined,
        }
        const rawDiff = bookmarkDiff
            ? app.jjDiff(
                  { from: bookmarkDiff.from, to: bookmarkDiff.to },
                  diffOptions,
              )
            : commit
              ? app.jjDiff({ revision: getRevisionId(commit) }, diffOptions)
              : Promise.resolve("")
        const fetcher = rawDiff.then((result) =>
            showJjFormatter ? result : parseDiffString(result),
        )

        fetcher
            .then((result) => {
                if (currentFetchKey !== fetchKey) return

                const fetchMs = performance.now() - fetchStart

                if (showJjFormatter) {
                    const renderedDiff = result as string
                    profileLog("diff-fetch-complete", {
                        fetchMs: Math.round(fetchMs),
                        flattenMs: 0,
                        files: 0,
                        lines: renderedDiff.split("\n").length,
                    })
                    profileMemory("memory:diff-fetch-complete")

                    const renderStart = performance.now()
                    setParsedFiles([])
                    setRawDiffOutput(renderedDiff)
                    setParsedDiffLoading(false)
                    const signalMs = performance.now() - renderStart

                    queueMicrotask(() => {
                        const totalRenderMs = performance.now() - renderStart
                        profileLog("diff-render-complete", {
                            signalMs: Math.round(signalMs * 100) / 100,
                            totalRenderMs:
                                Math.round(totalRenderMs * 100) / 100,
                        })
                        profileMemory("memory:diff-render-complete")
                    })
                    return
                }

                const parsedDiff = result as Parameters<typeof flattenDiff>[0]
                const flattenStart = performance.now()
                const flattened = flattenDiff(parsedDiff)
                const flattenMs = performance.now() - flattenStart

                const lineCount = flattened.reduce(
                    (sum, f) =>
                        sum + f.hunks.reduce((s, h) => s + h.lines.length, 0),
                    0,
                )

                profileLog("diff-fetch-complete", {
                    fetchMs: Math.round(fetchMs),
                    flattenMs: Math.round(flattenMs * 100) / 100,
                    files: flattened.length,
                    lines: lineCount,
                })
                profileMemory("memory:diff-fetch-complete")

                const renderStart = performance.now()
                setRawDiffOutput("")
                setParsedFiles(flattened)
                setParsedDiffLoading(false)
                const signalMs = performance.now() - renderStart

                queueMicrotask(() => {
                    const totalRenderMs = performance.now() - renderStart
                    profileLog("diff-render-complete", {
                        signalMs: Math.round(signalMs * 100) / 100,
                        totalRenderMs: Math.round(totalRenderMs * 100) / 100,
                    })
                    profileMemory("memory:diff-render-complete")
                })
            })
            .catch((err) => {
                if (currentFetchKey === fetchKey) {
                    setParsedDiffError(err.message)
                    setParsedDiffLoading(false)
                }
            })
    })

    let handledFileNavigationRequest = 0
    createEffect(() => {
        if (viewMode() !== "files" || useJjFormatter()) return
        const request = fileNavigationRequest()
        if (!request || request.id === handledFileNavigationRequest) return
        const file = orderedFiles().find(
            (candidate) =>
                candidate.name === request.path ||
                candidate.prevName === request.path,
        )
        if (!file) return
        const rowOffset = fileRowOffsets().get(file.fileId)
        if (rowOffset === undefined) return
        hunkNavigationTarget = null
        handledFileNavigationRequest = request.id
        const targetScrollTop = headerHeight() + rowOffset
        scrollRef?.scrollTo(targetScrollTop)
        setScrollTop(targetScrollTop)
    })

    createEffect(() => {
        if (viewMode() !== "files" || useJjFormatter()) {
            setCurrentDiffFilePath(null)
            return
        }
        setCurrentDiffFilePath(currentFile()?.name ?? null)
    })

    createEffect(() => {
        const commit = activeCommit()
        const bookmarkDiff = activeBookmarkDiff()
        const nextId = bookmarkDiff
            ? `${bookmarkDiff.from}..${bookmarkDiff.to}`
            : commit?.changeId
        if (nextId && nextId !== currentCommitId()) {
            hunkNavigationTarget = null
            setCurrentCommitId(nextId)
            setScrollTop(0)
            setScrollLeft(0)
            scrollRef?.scrollTo(0)
        }
    })

    createEffect(() => {
        if (wrapEnabled()) {
            setScrollLeft(0)
            return
        }
        setScrollLeftClamped(scrollLeft())
    })

    createEffect(() => {
        if (useJjFormatter()) return
        if (parsedFiles().length > 0) return
        if (headerHeight() > viewportHeight()) return
        if (scrollTop() === 0) return
        setScrollTop(0)
        scrollRef?.scrollTo(0)
    })

    const activeDiffSourceKey = () => {
        const bookmarkDiff = activeBookmarkDiff()
        if (bookmarkDiff) return `${bookmarkDiff.from}..${bookmarkDiff.to}`
        const commit = activeCommit()
        return commit ? `${commit.changeId}:${commit.commitId}` : null
    }

    const syncScrollMetrics = () => {
        if (!scrollRef) return
        const currentScroll = scrollRef.scrollTop ?? 0
        const currentViewport = scrollRef.viewport?.height ?? 30
        const currentHeaderHeight = headerRef?.height ?? 0
        const currentViewportWidth =
            scrollRef.viewport?.width ?? effectiveMainAreaWidth()
        const widthAdjustment = scrollRef.verticalScrollBar.visible
            ? SCROLLBAR_GUTTER
            : SCROLLBAR_GUTTER + 1
        const measuredWidth = Math.max(
            1,
            currentViewportWidth - widthAdjustment,
        )
        if (Math.abs(measuredWidth - effectiveMainAreaWidth()) > 2) {
            setMetricsMode(null)
            setMetricsSourceKey(null)
        } else {
            setMetricsMode(viewMode())
            setMetricsSourceKey(activeDiffSourceKey())
        }
        if (
            currentScroll !== scrollTop() ||
            currentViewport !== viewportHeight() ||
            currentHeaderHeight !== headerHeight() ||
            measuredWidth !== viewportWidth()
        ) {
            setViewportHeight(currentViewport)
            setScrollTop(currentScroll)
            setHeaderHeight(currentHeaderHeight)
            setViewportWidth(measuredWidth)
        }
    }

    let scrollSyncTimer: ReturnType<typeof setTimeout> | undefined
    const handleScroll = (event: MouseEvent) => {
        hunkNavigationTarget = null
        handleHorizontalScroll(event)
        if (scrollSyncTimer) return
        scrollSyncTimer = setTimeout(() => {
            scrollSyncTimer = undefined
            syncScrollMetrics()
        }, 0)
    }

    onMount(() => {
        const unsubscribeConfig = onConfigChange((config) => {
            setDiffLayout(config.diff.layout)
            setDiffAutoSwitchWidth(config.diff.autoSwitchWidth)
            setDiffWrap(config.diff.wrap)
            setDiffUseJjFormatter(config.diff.useJjFormatter)
            setUseJjFormatterOverride(null)
            setViewStyleOverride(null)
            setWrapOverride(null)
        })
        onCleanup(unsubscribeConfig)

        const handleDetailResize = () => queueMicrotask(syncScrollMetrics)
        scrollRef?.on("resize", handleDetailResize)
        headerRef?.on("resize", handleDetailResize)
        onCleanup(() => scrollRef?.off("resize", handleDetailResize))
        onCleanup(() => headerRef?.off("resize", handleDetailResize))

        const pollInterval = setInterval(syncScrollMetrics, 100)
        onCleanup(() => clearInterval(pollInterval))
        onCleanup(() => clearTimeout(scrollSyncTimer))
    })

    const isFocused = () => focus.isPanel("detail")

    // Adjust scrollTop for virtualization: subtract header height so virtualization
    // calculates visible rows relative to diff content, not entire scrollbox
    const adjustedScrollTop = createMemo(() =>
        Math.max(0, scrollTop() - headerHeight()),
    )

    const openPathsInEditor = async (paths: string[], line?: number) => {
        const uniquePaths = [...new Set(paths)]
        if (uniquePaths.length === 0) {
            commandLog.addEntry({
                command: "open editor",
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: "No openable files in this diff",
            })
            return
        }

        const repoPath = getRepoPath()
        const commit = activeCommit()
        let editorPaths: string[]
        try {
            editorPaths =
                commit && !commit.isWorkingCopy
                    ? await app.jjMaterializeFiles(
                          commit.commitId,
                          uniquePaths,
                          { cwd: repoPath },
                      )
                    : uniquePaths.map((path) => resolve(repoPath, path))
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to read file at revision"
            status.show(message)
            commandLog.addEntry({
                command: "open historical file",
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: message,
            })
            return
        }

        const shouldSuspend = shouldSuspendForEditor()
        if (shouldSuspend) renderer.suspend?.()
        try {
            const result = await openInEditor(editorPaths, {
                cwd: repoPath,
                line,
            })
            commandLog.addEntry({
                ...result,
                stdout: "",
                stderr: result.success
                    ? ""
                    : `Editor exited with code ${result.exitCode}`,
            })
        } finally {
            if (shouldSuspend) renderer.resume?.()
        }

        await refresh()
    }

    const openCurrentFileInEditor = async (fromFilesPanel: boolean) => {
        if (fromFilesPanel) {
            const node = selectedFile()?.node
            if (!node || node.isDirectory) {
                await openPathsInEditor([])
                return
            }
            if (node.isBinary) {
                commandLog.addEntry({
                    command: "open editor",
                    success: false,
                    exitCode: 1,
                    stdout: "",
                    stderr: `Cannot open binary file: ${node.path}`,
                })
                return
            }
            if (node.status === "deleted") {
                commandLog.addEntry({
                    command: "open editor",
                    success: false,
                    exitCode: 1,
                    stdout: "",
                    stderr: `Cannot open deleted file: ${node.path}`,
                })
                return
            }
            const line =
                currentFile()?.name === node.path
                    ? currentDiffPosition()?.lineNumber
                    : undefined
            await openPathsInEditor([node.path], line)
            return
        }

        const file = currentFile()
        if (!file) {
            await openPathsInEditor([])
            return
        }
        if (file.isBinary) {
            commandLog.addEntry({
                command: "open editor",
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: `Cannot open binary file: ${file.name}`,
            })
            return
        }
        if (file.type === "deleted") {
            commandLog.addEntry({
                command: "open editor",
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: `Cannot open deleted file: ${file.name}`,
            })
            return
        }
        await openPathsInEditor([file.name], currentDiffPosition()?.lineNumber)
    }

    // Editor actions intentionally target text files: line navigation and
    // normal editor behavior aren't meaningful for binary content.
    const openAllFilesInEditor = (fromFilesPanel: boolean) =>
        openPathsInEditor(
            fromFilesPanel
                ? flatFiles()
                      .filter(
                          (file) =>
                              !file.node.isDirectory &&
                              !file.node.isBinary &&
                              file.node.status !== "deleted",
                      )
                      .map((file) => file.node.path)
                : orderedFiles()
                      .filter(
                          (file) => !file.isBinary && file.type !== "deleted",
                      )
                      .map((file) => file.name),
        )

    command.register(() => [
        {
            id: "log.files.open_editor",
            title: "open",
            keybind: "open_editor",
            context: "log.files",
            panel: "log",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => openCurrentFileInEditor(true),
        },
        {
            id: "log.files.open_editor_all",
            title: "open all",
            keybind: "open_editor_all",
            context: "log.files",
            panel: "log",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => openAllFilesInEditor(true),
        },
        ...(!useJjFormatter()
            ? [
                  {
                      id: "detail.open_editor",
                      title: "open",
                      keybind: "open_editor" as const,
                      context: "detail.diff_custom" as const,
                      panel: "detail" as const,
                      visibleIn: ["palette", "statusBar"] as const,
                      execute: () => openCurrentFileInEditor(false),
                  },
                  {
                      id: "detail.open_editor_all",
                      title: "open all",
                      keybind: "open_editor_all" as const,
                      context: "detail.diff_custom" as const,
                      panel: "detail" as const,
                      visibleIn: ["palette", "statusBar"] as const,
                      execute: () => openAllFilesInEditor(false),
                  },
              ]
            : []),
        {
            id: "detail.scroll_down",
            title: "scroll down",
            keybind: "nav_down",
            context: "detail",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => {
                hunkNavigationTarget = null
                scrollRef?.scrollTo((scrollTop() || 0) + 1)
                setScrollTop((scrollTop() || 0) + 1)
            },
        },
        {
            id: "detail.scroll_up",
            title: "scroll up",
            keybind: "nav_up",
            context: "detail",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => {
                hunkNavigationTarget = null
                const newPos = Math.max(0, (scrollTop() || 0) - 1)
                scrollRef?.scrollTo(newPos)
                setScrollTop(newPos)
            },
        },
        {
            id: "detail.toggle_diff_style",
            title: "diff view",
            keybind: "toggle_diff_style",
            context: "detail.diff_custom",

            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                setViewStyleOverride((s) => {
                    const current = s ?? viewStyle()
                    return current === "unified" ? "split" : "unified"
                })
            },
        },
        {
            id: "detail.toggle_diff_wrap",
            title: "wrap",
            keybind: "toggle_diff_wrap",
            context: "detail.diff_custom",

            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                setWrapOverride((enabled) => {
                    const current = enabled ?? wrapEnabled()
                    return !current
                })
            },
        },
        {
            id: "log.files.toggle_diff_style",
            title: "diff view",
            keybind: "toggle_diff_style",
            context: "log.files",

            panel: "log",
            visibleIn: ["statusBar"] as const,
            execute: () => {
                setViewStyleOverride((s) => {
                    const current = s ?? viewStyle()
                    return current === "unified" ? "split" : "unified"
                })
            },
        },
        {
            id: "log.files.toggle_diff_wrap",
            title: "wrap",
            keybind: "toggle_diff_wrap",
            context: "log.files",

            panel: "log",
            visibleIn: ["statusBar"] as const,
            execute: () => {
                setWrapOverride((enabled) => {
                    const current = enabled ?? wrapEnabled()
                    return !current
                })
            },
        },
        {
            id: "detail.scroll_left",
            title: "scroll left",
            keybind: "diff_scroll_left",
            context: "detail",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => {
                if (wrapEnabled()) return
                setScrollLeftClamped(scrollLeft() - HORIZONTAL_SCROLL_STEP)
            },
        },
        {
            id: "detail.scroll_right",
            title: "scroll right",
            keybind: "diff_scroll_right",
            context: "detail",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => {
                if (wrapEnabled()) return
                setScrollLeftClamped(scrollLeft() + HORIZONTAL_SCROLL_STEP)
            },
        },
        {
            id: "detail.toggle_jj_formatter",
            title: "diff tool",
            keybind: "toggle_diff_formatter",
            context: "detail",

            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                setUseJjFormatterOverride((enabled) => {
                    if (enabled === null) {
                        return !diffUseJjFormatter()
                    }
                    return !enabled
                })
            },
        },
        {
            id: "detail.prev_hunk",
            title: "previous hunk",
            keybind: "nav_prev_hunk",
            context: "detail.diff_custom",
            group: "navigation",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                navigateHunk(-1)
            },
        },
        {
            id: "detail.next_hunk",
            title: "next hunk",
            keybind: "nav_next_hunk",
            context: "detail.diff_custom",
            group: "navigation",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                navigateHunk(1)
            },
        },
        {
            id: "detail.page_up",
            title: "page up",
            keybind: "nav_page_up",
            context: "detail",
            group: "navigation",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                hunkNavigationTarget = null
                scrollRef?.scrollBy(-0.5, "viewport")
                if (scrollRef) setScrollTop(scrollRef.scrollTop)
            },
        },
        {
            id: "detail.page_down",
            title: "page down",
            keybind: "nav_page_down",
            context: "detail",
            group: "navigation",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                hunkNavigationTarget = null
                scrollRef?.scrollBy(0.5, "viewport")
                if (scrollRef) setScrollTop(scrollRef.scrollTop)
            },
        },
        {
            id: "detail.prev_file",
            title: "previous file",
            keybind: "nav_prev_file",
            context: "detail.diff_custom",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => {
                navigateFile(-1)
            },
        },
        {
            id: "detail.next_file",
            title: "next file",
            keybind: "nav_next_file",
            context: "detail.diff_custom",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => {
                navigateFile(1)
            },
        },
    ])

    const isLoading = () => parsedDiffLoading()
    const hasError = () => parsedDiffError()
    const hasContent = () =>
        useJjFormatter()
            ? stripAnsi(rawDiffOutput()).trim().length > 0
            : parsedFiles().length > 0
    const showEmptyState = () =>
        (activeCommit() || activeBookmarkDiff()) &&
        !isLoading() &&
        !hasError() &&
        !hasContent()
    return (
        <Panel
            title="Detail"
            hotkey="3"
            panelId="detail"
            focused={isFocused()}
            overflow="visible"
            topRight={renderRepoInfo}
        >
            <Show when={hasError()}>
                <text>Error: {hasError()}</text>
            </Show>
            <Show when={hasContent() || (!isLoading() && !hasError())}>
                <box flexGrow={1} paddingRight={SCROLLBAR_GUTTER}>
                    <scrollbox
                        ref={scrollRef}
                        focused={isFocused()}
                        flexGrow={1}
                        scrollX={false}
                        verticalScrollbarOptions={{
                            trackOptions: {
                                backgroundColor: colors().scrollbarTrack,
                                foregroundColor: colors().scrollbarThumb,
                            },
                        }}
                        horizontalScrollbarOptions={{ visible: false }}
                        onMouseScroll={handleScroll}
                    >
                        <box flexDirection="column">
                            <box
                                ref={headerRef}
                                flexDirection="column"
                                flexShrink={0}
                            >
                                <Show when={activeBookmarkDiff()}>
                                    <BookmarkDiffHeader
                                        bookmark={
                                            activeBookmarkDiff()?.bookmark ?? ""
                                        }
                                        from={activeBookmarkDiff()?.from ?? ""}
                                        to={activeBookmarkDiff()?.to ?? ""}
                                    />
                                </Show>
                                <Show
                                    when={
                                        viewMode() !== "files" &&
                                        !activeBookmarkDiff() &&
                                        activeCommit()
                                    }
                                >
                                    {(commit: () => Commit) => (
                                        <CommitHeader
                                            commit={commit()}
                                            details={commitDetails()}
                                            stats={diffStats()}
                                            maxWidth={Math.max(
                                                1,
                                                viewportWidth(),
                                            )}
                                        />
                                    )}
                                </Show>
                            </box>
                            <Show when={parsedDiffError()}>
                                <text fg={colors().error}>
                                    Error: {parsedDiffError()}
                                </text>
                            </Show>
                            <Show when={!parsedDiffError()}>
                                <Show
                                    when={
                                        showEmptyState() &&
                                        metricsMode() === viewMode() &&
                                        metricsSourceKey() ===
                                            activeDiffSourceKey()
                                    }
                                >
                                    <EmptyDiffState
                                        width={Math.max(1, viewportWidth())}
                                        height={Math.max(
                                            1,
                                            viewportHeight() - headerHeight(),
                                        )}
                                        normalMode={viewMode() !== "files"}
                                    />
                                </Show>
                                <Show
                                    when={useJjFormatter() && !showEmptyState()}
                                >
                                    <AnsiText
                                        content={rawDiffOutput()}
                                        wrapMode="none"
                                        cropStart={scrollLeft()}
                                        cropWidth={Math.max(1, viewportWidth())}
                                    />
                                </Show>
                                <Show
                                    when={
                                        !useJjFormatter() &&
                                        parsedFiles().length > 0
                                    }
                                >
                                    <box flexDirection="column">
                                        <Show
                                            when={
                                                viewStyle() === "unified" &&
                                                textFiles().length > 0
                                            }
                                        >
                                            <VirtualizedUnifiedView
                                                files={textFiles()}
                                                activeFileId={null}
                                                onHunkRowOffsets={
                                                    setHunkRowOffsets
                                                }
                                                onFileRowOffsets={
                                                    setFileRowOffsets
                                                }
                                                onCurrentFileChange={
                                                    setCurrentFileId
                                                }
                                                onCurrentPositionChange={
                                                    setCurrentDiffPosition
                                                }
                                                onScrollTailHeight={
                                                    setScrollTailHeight
                                                }
                                                scrollTop={adjustedScrollTop()}
                                                viewportHeight={viewportHeight()}
                                                leadingContentHeight={headerHeight()}
                                                viewportWidth={viewportWidth()}
                                                wrapEnabled={wrapEnabled()}
                                                scrollLeft={scrollLeft()}
                                            />
                                        </Show>
                                        <Show
                                            when={
                                                viewStyle() === "split" &&
                                                textFiles().length > 0
                                            }
                                        >
                                            <VirtualizedSplitView
                                                files={textFiles()}
                                                activeFileId={null}
                                                onHunkRowOffsets={
                                                    setHunkRowOffsets
                                                }
                                                onFileRowOffsets={
                                                    setFileRowOffsets
                                                }
                                                onCurrentFileChange={
                                                    setCurrentFileId
                                                }
                                                onCurrentPositionChange={
                                                    setCurrentDiffPosition
                                                }
                                                onScrollTailHeight={
                                                    setScrollTailHeight
                                                }
                                                scrollTop={adjustedScrollTop()}
                                                viewportHeight={viewportHeight()}
                                                leadingContentHeight={headerHeight()}
                                                viewportWidth={viewportWidth()}
                                                wrapEnabled={wrapEnabled()}
                                                scrollLeft={scrollLeft()}
                                            />
                                        </Show>
                                        <Show when={binaryPaths().length > 0}>
                                            <BinaryGroupFooter
                                                width={Math.max(
                                                    1,
                                                    viewportWidth(),
                                                )}
                                                paths={binaryPaths()}
                                            />
                                        </Show>
                                        <Show when={textFiles().length > 0}>
                                            <box
                                                height={scrollTailHeight()}
                                                flexShrink={0}
                                            />
                                        </Show>
                                    </box>
                                </Show>
                            </Show>
                        </box>
                    </scrollbox>
                    <Show
                        when={
                            !useJjFormatter() && scrollTop() > headerHeight()
                                ? currentFile()
                                : undefined
                        }
                    >
                        {(file: () => FlattenedFile) => (
                            <box
                                position="absolute"
                                top={0}
                                left={0}
                                right={SCROLLBAR_GUTTER}
                                zIndex={10}
                            >
                                <DiffFileHeader
                                    file={file()}
                                    maxWidth={Math.max(1, viewportWidth() - 2)}
                                />
                            </box>
                        )}
                    </Show>
                </box>
            </Show>
        </Panel>
    )
}
