import type {
	BoxRenderable,
	MouseEvent,
	ScrollBoxRenderable,
} from "@opentui/core"
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
import type { Commit } from "../../commander/types"
import { useCommand } from "../../context/command"
import { useFocus } from "../../context/focus"
import { useLayout } from "../../context/layout"
import { type CommitDetails, useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import {
	type FlattenedFile,
	fetchParsedDiff,
	flattenDiff,
	getLineNumWidth,
	getMaxLineNumber,
} from "../../diff"
import { getFilePaths } from "../../utils/file-tree"
import { AnsiText } from "../AnsiText"
import { Panel } from "../Panel"
import { VirtualizedSplitView, VirtualizedUnifiedView } from "../diff"

type DiffViewStyle = "unified" | "split"

import { profileLog } from "../../utils/profiler"

const SPLIT_VIEW_THRESHOLD = 140
const DIFF_RIGHT_PADDING = 1
const HORIZONTAL_SCROLL_STEP = 5

function FileStats(props: { stats: DiffStats; maxWidth: number }) {
	const { colors } = useTheme()
	const s = () => props.stats

	const separatorWidth = 3 // " | "
	const barMargin = 2 // margin on right side

	// Scale +/- counts to fit within available width while preserving ratio
	const scaleBar = (
		insertions: number,
		deletions: number,
		availableWidth: number,
	) => {
		const total = insertions + deletions
		if (total === 0) return { plus: 0, minus: 0 }
		if (total <= availableWidth) return { plus: insertions, minus: deletions }

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
			<For each={s().files}>
				{(file) => {
					// Calculate available width for bar based on actual path length
					const pathLen = file.path.length
					const availableBarWidth = Math.max(
						1,
						props.maxWidth - pathLen - separatorWidth - barMargin,
					)
					const bar = scaleBar(
						file.insertions,
						file.deletions,
						availableBarWidth,
					)
					return (
						<text wrapMode="none">
							<span style={{ fg: colors().text }}>{file.path}</span>
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
				{s().totalFiles} file{s().totalFiles !== 1 ? "s" : ""} changed
				<Show when={s().totalInsertions > 0}>
					{", "}
					<span style={{ fg: colors().success }}>
						{s().totalInsertions} insertion
						{s().totalInsertions !== 1 ? "s" : ""}(+)
					</span>
				</Show>
				<Show when={s().totalDeletions > 0}>
					{", "}
					<span style={{ fg: colors().error }}>
						{s().totalDeletions} deletion
						{s().totalDeletions !== 1 ? "s" : ""}(-)
					</span>
				</Show>
			</text>
			<text fg={colors().textMuted}>{"─".repeat(props.maxWidth)}</text>
		</>
	)
}

// Remove email and date/time from jj's refLine, preserving ANSI colors
function stripEmailAndDate(
	refLine: string,
	email: string,
	timestamp: string,
): string {
	let result = refLine

	// Escape special regex chars in the strings we're removing
	const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

	// Pattern to match text with optional surrounding ANSI codes
	const ansiWrap = (s: string) =>
		`(?:\\x1b\\[[0-9;]*m)*${s}(?:\\x1b\\[[0-9;]*m)*\\s*`

	// Remove email
	if (email) {
		const emailPattern = new RegExp(ansiWrap(escapeRegex(email)), "g")
		result = result.replace(emailPattern, "")
	}

	// Remove date and time (timestamp is "2026-01-10 13:38:26 -0800", refLine has "2026-01-10 13:38:26")
	if (timestamp) {
		const [date, time] = timestamp.split(" ")
		if (date) {
			const datePattern = new RegExp(ansiWrap(escapeRegex(date)), "g")
			result = result.replace(datePattern, "")
		}
		if (time) {
			const timePattern = new RegExp(ansiWrap(escapeRegex(time)), "g")
			result = result.replace(timePattern, "")
		}
	}

	return result
}

function MinimalCommitHeader(props: {
	commit: Commit
	details: CommitDetails | null
}) {
	const subject = () => props.details?.subject || props.commit.description
	const cleanRefLine = () =>
		stripEmailAndDate(
			props.commit.refLine,
			props.commit.authorEmail,
			props.commit.timestamp,
		)

	return (
		<box flexDirection="column" flexShrink={0}>
			<AnsiText content={cleanRefLine()} wrapMode="none" />
			<box flexDirection="row">
				<text>{"    "}</text>
				<AnsiText content={subject()} wrapMode="none" />
			</box>
		</box>
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
				<span style={{ fg: colors().secondary }}>{props.commit.timestamp}</span>
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
								<text>
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
					props.stats && props.stats.totalFiles > 0 ? props.stats : undefined
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
	const {
		activeCommit,
		commitDetails,
		viewMode,
		selectedFile,
		bookmarkViewMode,
		selectedBookmarkFile,
	} = useSync()
	const layout = useLayout()
	const { mainAreaWidth } = layout
	const { colors } = useTheme()
	const focus = useFocus()
	const command = useCommand()

	let scrollRef: ScrollBoxRenderable | undefined
	let headerRef: BoxRenderable | undefined

	const [scrollTop, setScrollTop] = createSignal(0)
	const [viewportHeight, setViewportHeight] = createSignal(30)
	const [viewportWidth, setViewportWidth] = createSignal(80)
	const [scrollLeft, setScrollLeft] = createSignal(0)
	const [headerHeight, setHeaderHeight] = createSignal(0)
	const [currentCommitId, setCurrentCommitId] = createSignal<string | null>(
		null,
	)

	const [viewStyle, setViewStyle] = createSignal<DiffViewStyle>("unified")
	const [wrapEnabled, setWrapEnabled] = createSignal(true)

	createEffect(() => {
		setViewStyle(mainAreaWidth() >= SPLIT_VIEW_THRESHOLD ? "split" : "unified")
	})
	const [parsedFiles, setParsedFiles] = createSignal<FlattenedFile[]>([])
	const [parsedDiffLoading, setParsedDiffLoading] = createSignal(false)
	const [parsedDiffError, setParsedDiffError] = createSignal<string | null>(
		null,
	)
	const [activeFileIndex, setActiveFileIndex] = createSignal(0)
	const [activeHunkIndex, setActiveHunkIndex] = createSignal(0)

	// Derived state
	const activeFileId = createMemo(() => {
		const files = parsedFiles()
		const idx = activeFileIndex()
		return files[idx]?.fileId ?? null
	})

	const activeHunkId = createMemo(() => {
		const files = parsedFiles()
		const fileIdx = activeFileIndex()
		const hunkIdx = activeHunkIndex()
		const file = files[fileIdx]
		return file?.hunks[hunkIdx]?.hunkId ?? null
	})

	const diffStats = createMemo((): DiffStats | null => {
		const files = parsedFiles()
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
		let maxUnified = 0
		let maxLeft = 0
		let maxRight = 0
		for (const file of parsedFiles()) {
			for (const hunk of file.hunks) {
				for (const line of hunk.lines) {
					const length = line.content.replace(/\n$/, "").length
					if (length > maxUnified) maxUnified = length
					switch (line.type) {
						case "context":
							if (length > maxLeft) maxLeft = length
							if (length > maxRight) maxRight = length
							break
						case "deletion":
							if (length > maxLeft) maxLeft = length
							break
						case "addition":
							if (length > maxRight) maxRight = length
							break
					}
				}
			}
		}
		return { maxUnified, maxLeft, maxRight }
	})

	const lineNumWidth = createMemo(() => {
		const maxLine = getMaxLineNumber(parsedFiles())
		return Math.max(1, getLineNumWidth(maxLine))
	})

	const diffContentWidth = createMemo(() => {
		const width = Math.max(1, viewportWidth())
		const prefixWidth = lineNumWidth() + 5 + DIFF_RIGHT_PADDING
		if (viewStyle() === "split") {
			const columnWidth = Math.max(1, Math.floor((width - 1) / 2))
			return Math.max(1, columnWidth - prefixWidth)
		}
		return Math.max(1, width - prefixWidth)
	})

	const maxScrollableWidth = createMemo(() => {
		if (viewStyle() === "split") {
			const { maxLeft, maxRight } = maxLineLengths()
			return Math.max(maxLeft, maxRight)
		}
		return maxLineLengths().maxUnified
	})

	const maxScrollLeft = createMemo(() => {
		if (wrapEnabled()) return 0
		return Math.max(0, maxScrollableWidth() - diffContentWidth())
	})

	const setScrollLeftClamped = (value: number) => {
		const next = Math.max(0, Math.min(value, maxScrollLeft()))
		if (next !== scrollLeft()) setScrollLeft(next)
	}

	const handleHorizontalScroll = (event: MouseEvent) => {
		if (!event.scroll || wrapEnabled()) return
		const delta = event.scroll.delta || 1
		if (event.scroll.direction === "left") {
			setScrollLeftClamped(scrollLeft() - delta)
			event.preventDefault()
			event.stopPropagation()
			return
		}
		if (event.scroll.direction === "right") {
			setScrollLeftClamped(scrollLeft() + delta)
			event.preventDefault()
			event.stopPropagation()
		}
	}

	// Navigation functions
	const navigateFile = (direction: 1 | -1) => {
		const files = parsedFiles()
		if (files.length === 0) return
		const newIdx = Math.max(
			0,
			Math.min(files.length - 1, activeFileIndex() + direction),
		)
		setActiveFileIndex(newIdx)
		setActiveHunkIndex(0) // Reset hunk when changing files
		scrollRef?.scrollTo(0)
	}

	const navigateHunk = (direction: 1 | -1) => {
		const files = parsedFiles()
		const fileIdx = activeFileIndex()
		const file = files[fileIdx]
		if (!file) return

		const hunkIdx = activeHunkIndex()
		const newHunkIdx = hunkIdx + direction

		if (newHunkIdx < 0) {
			// Go to previous file's last hunk
			if (fileIdx > 0) {
				const prevFile = files[fileIdx - 1]
				setActiveFileIndex(fileIdx - 1)
				setActiveHunkIndex(prevFile ? prevFile.hunks.length - 1 : 0)
			}
		} else if (newHunkIdx >= file.hunks.length) {
			// Go to next file's first hunk
			if (fileIdx < files.length - 1) {
				setActiveFileIndex(fileIdx + 1)
				setActiveHunkIndex(0)
			}
		} else {
			setActiveHunkIndex(newHunkIdx)
		}
	}

	// Track current fetch to prevent stale updates
	let currentFetchKey: string | null = null

	// Fetch parsed diff when commit/file changes
	createEffect(() => {
		const commit = activeCommit()
		const vMode = viewMode()
		const bmMode = bookmarkViewMode()
		const focusedPanel = focus.panel()

		if (!commit) return

		let paths: string[] | undefined

		// Determine file paths based on context (mirrors sync.tsx logic)
		if (focusedPanel === "refs" && bmMode === "files") {
			const file = selectedBookmarkFile()
			if (file) {
				paths = file.node.isDirectory
					? getFilePaths(file.node)
					: [file.node.path]
			}
		} else if (vMode === "files") {
			const file = selectedFile()
			if (file) {
				paths = file.node.isDirectory
					? getFilePaths(file.node)
					: [file.node.path]
			}
		}

		const fetchKey = `${commit.changeId}:${commit.commitId}:${paths?.join(",") ?? "all"}`
		if (fetchKey === currentFetchKey) return
		currentFetchKey = fetchKey

		setParsedDiffLoading(true)
		setParsedDiffError(null)

		const fetchStart = performance.now()
		fetchParsedDiff(commit.changeId, { paths })
			.then((files) => {
				if (currentFetchKey !== fetchKey) return

				const fetchMs = performance.now() - fetchStart

				const flattenStart = performance.now()
				const flattened = flattenDiff(files)
				const flattenMs = performance.now() - flattenStart

				const lineCount = flattened.reduce(
					(sum, f) => sum + f.hunks.reduce((s, h) => s + h.lines.length, 0),
					0,
				)

				profileLog("diff-fetch-complete", {
					fetchMs: Math.round(fetchMs),
					flattenMs: Math.round(flattenMs * 100) / 100,
					files: flattened.length,
					lines: lineCount,
				})

				const renderStart = performance.now()
				setParsedFiles(flattened)
				setParsedDiffLoading(false)
				const signalMs = performance.now() - renderStart

				queueMicrotask(() => {
					const totalRenderMs = performance.now() - renderStart
					profileLog("diff-render-complete", {
						signalMs: Math.round(signalMs * 100) / 100,
						totalRenderMs: Math.round(totalRenderMs * 100) / 100,
					})
				})
			})
			.catch((err) => {
				if (currentFetchKey === fetchKey) {
					setParsedDiffError(err.message)
					setParsedDiffLoading(false)
				}
			})
	})

	createEffect(() => {
		const commit = activeCommit()
		if (commit && commit.changeId !== currentCommitId()) {
			setCurrentCommitId(commit.changeId)
			setScrollTop(0)
			setScrollLeft(0)
			scrollRef?.scrollTo(0)
			// Reset navigation when switching commits (keep stale content for SWR)
			setActiveFileIndex(0)
			setActiveHunkIndex(0)
		}
	})

	createEffect(() => {
		if (wrapEnabled()) {
			setScrollLeft(0)
			return
		}
		setScrollLeftClamped(scrollLeft())
	})

	onMount(() => {
		const pollInterval = setInterval(() => {
			if (scrollRef) {
				const currentScroll = scrollRef.scrollTop ?? 0
				const currentViewport = scrollRef.viewport?.height ?? 30
				const currentHeaderHeight = headerRef?.height ?? 0
				const currentViewportWidth =
					scrollRef.viewport?.width ?? mainAreaWidth()
				if (
					currentScroll !== scrollTop() ||
					currentViewport !== viewportHeight() ||
					currentHeaderHeight !== headerHeight() ||
					currentViewportWidth !== viewportWidth()
				) {
					setViewportHeight(currentViewport)
					setScrollTop(currentScroll)
					setHeaderHeight(currentHeaderHeight)
					setViewportWidth(currentViewportWidth)
				}
			}
		}, 100)
		onCleanup(() => clearInterval(pollInterval))
	})

	const isFocused = () => focus.isPanel("detail")

	// Adjust scrollTop for virtualization: subtract header height so virtualization
	// calculates visible rows relative to diff content, not entire scrollbox
	const adjustedScrollTop = createMemo(() =>
		Math.max(0, scrollTop() - headerHeight()),
	)

	command.register(() => [
		{
			id: "detail.page_up",
			title: "page up",
			keybind: "nav_page_up",
			context: "detail",
			type: "navigation",
			onSelect: () => {
				scrollRef?.scrollBy(-0.5, "viewport")
				if (scrollRef) setScrollTop(scrollRef.scrollTop)
			},
		},
		{
			id: "detail.page_down",
			title: "page down",
			keybind: "nav_page_down",
			context: "detail",
			type: "navigation",
			onSelect: () => {
				scrollRef?.scrollBy(0.5, "viewport")
				if (scrollRef) setScrollTop(scrollRef.scrollTop)
			},
		},
		{
			id: "detail.scroll_down",
			title: "scroll down",
			keybind: "nav_down",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				scrollRef?.scrollTo((scrollTop() || 0) + 1)
				setScrollTop((scrollTop() || 0) + 1)
			},
		},
		{
			id: "detail.scroll_up",
			title: "scroll up",
			keybind: "nav_up",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				const newPos = Math.max(0, (scrollTop() || 0) - 1)
				scrollRef?.scrollTo(newPos)
				setScrollTop(newPos)
			},
		},
		{
			id: "detail.toggle_diff_style",
			title: "toggle split/unified",
			keybind: "toggle_diff_style",
			context: "detail",
			type: "view",
			visibility: "status-only",
			onSelect: () => {
				setViewStyle((s) => (s === "unified" ? "split" : "unified"))
			},
		},
		{
			id: "detail.toggle_diff_wrap",
			title: "toggle wrap",
			keybind: "toggle_diff_wrap",
			context: "detail",
			type: "view",
			visibility: "status-only",
			onSelect: () => {
				setWrapEnabled((enabled) => !enabled)
			},
		},
		{
			id: "detail.scroll_left",
			title: "scroll left",
			keybind: "diff_scroll_left",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				if (wrapEnabled()) return
				setScrollLeftClamped(scrollLeft() - HORIZONTAL_SCROLL_STEP)
			},
		},
		{
			id: "detail.scroll_right",
			title: "scroll right",
			keybind: "diff_scroll_right",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				if (wrapEnabled()) return
				setScrollLeftClamped(scrollLeft() + HORIZONTAL_SCROLL_STEP)
			},
		},
		{
			id: "detail.prev_hunk",
			title: "previous hunk",
			keybind: "nav_prev_hunk",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				navigateHunk(-1)
			},
		},
		{
			id: "detail.next_hunk",
			title: "next hunk",
			keybind: "nav_next_hunk",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				navigateHunk(1)
			},
		},
		{
			id: "detail.prev_file",
			title: "previous file",
			keybind: "nav_prev_file",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				navigateFile(-1)
			},
		},
		{
			id: "detail.next_file",
			title: "next file",
			keybind: "nav_next_file",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				navigateFile(1)
			},
		},
	])

	const isLoading = () => parsedDiffLoading()
	const hasError = () => parsedDiffError()
	const hasContent = () => parsedFiles().length > 0

	return (
		<Panel title="Detail" hotkey="3" panelId="detail" focused={isFocused()}>
			<Show when={hasError()}>
				<text>Error: {hasError()}</text>
			</Show>
			<Show when={hasContent() || (!isLoading() && !hasError())}>
				<scrollbox
					ref={scrollRef}
					focused={isFocused()}
					flexGrow={1}
					scrollX={false}
					scrollbarOptions={{
						trackOptions: {
							backgroundColor: colors().scrollbarTrack,
							foregroundColor: colors().scrollbarThumb,
						},
					}}
					onMouseScroll={handleHorizontalScroll}
				>
					<box ref={headerRef} flexDirection="column" flexShrink={0}>
						<Show when={activeCommit()}>
							{(commit: () => Commit) => (
								<Show
									when={
										viewMode() !== "files" && bookmarkViewMode() !== "files"
									}
									fallback={
										<MinimalCommitHeader
											commit={commit()}
											details={commitDetails()}
										/>
									}
								>
									<CommitHeader
										commit={commit()}
										details={commitDetails()}
										stats={diffStats()}
										maxWidth={mainAreaWidth()}
									/>
								</Show>
							)}
						</Show>
					</box>
					<Show when={parsedDiffError()}>
						<text fg={colors().error}>Error: {parsedDiffError()}</text>
					</Show>
					<Show when={!parsedDiffError()}>
						<Show when={parsedFiles().length > 0}>
							<box flexDirection="column">
								<Show when={viewStyle() === "unified"}>
									<VirtualizedUnifiedView
										files={parsedFiles()}
										activeFileId={null}
										currentHunkId={activeHunkId()}
										scrollTop={adjustedScrollTop()}
										viewportHeight={viewportHeight()}
										viewportWidth={viewportWidth()}
										wrapEnabled={wrapEnabled()}
										scrollLeft={scrollLeft()}
										onHorizontalScroll={handleHorizontalScroll}
									/>
								</Show>
								<Show when={viewStyle() === "split"}>
									<VirtualizedSplitView
										files={parsedFiles()}
										activeFileId={null}
										currentHunkId={activeHunkId()}
										scrollTop={adjustedScrollTop()}
										viewportHeight={viewportHeight()}
										viewportWidth={viewportWidth()}
										wrapEnabled={wrapEnabled()}
										scrollLeft={scrollLeft()}
										onHorizontalScroll={handleHorizontalScroll}
									/>
								</Show>
							</box>
						</Show>
					</Show>
				</scrollbox>
			</Show>
		</Panel>
	)
}
