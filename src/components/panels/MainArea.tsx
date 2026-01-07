import type { ScrollBoxRenderable } from "@opentui/core"
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
import { type CommitDetails, type ViewMode, useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { type FlattenedFile, fetchParsedDiff, flattenDiff } from "../../diff"
import { getFilePaths } from "../../utils/file-tree"
import { AnsiText } from "../AnsiText"
import { Panel } from "../Panel"
import { FileSummary, VirtualizedSplitView, VirtualizedUnifiedView } from "../diff"

type DiffRenderMode = "passthrough" | "custom"
type DiffViewStyle = "unified" | "split"

import { profileLog } from "../../utils/profiler"

const INITIAL_LIMIT = 1000
const LIMIT_INCREMENT = 200
const LOAD_THRESHOLD = 200
const SPLIT_VIEW_THRESHOLD = 90

function formatTimestamp(timestamp: string): string {
	// Input: "2026-01-02 14:30:45 -0800"
	// Output: "Thu Jan 2 14:30:45 2026 -0800"
	const match = timestamp.match(
		/(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) (.+)/,
	)
	if (!match) return timestamp

	const [, year, month, day, time, tz] = match
	const date = new Date(`${year}-${month}-${day}T${time}`)
	const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
	const monthNames = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	]
	const dayName = dayNames[date.getDay()]
	const monthName = monthNames[date.getMonth()]
	const dayNum = date.getDate()

	return `${dayName} ${monthName} ${dayNum} ${time} ${year} ${tz}`
}

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

function CommitHeader(props: {
	commit: Commit
	details: CommitDetails | null
	maxWidth: number
}) {
	const { colors } = useTheme()

	// Stale-while-revalidate: show details as-is (may be stale from previous commit)
	// until new details arrive. This prevents flash during navigation.
	const subject = () => props.details?.subject || props.commit.description
	const stats = () => props.details?.stats

	const bodyLines = createMemo(() => {
		const b = props.details?.body
		return b ? b.split("\n") : null
	})

	return (
		<box flexDirection="column" flexShrink={0}>
			<text>
				<span style={{ fg: colors().warning }}>{props.commit.changeId}</span>{" "}
				<span style={{ fg: colors().textMuted }}>{props.commit.commitId}</span>
			</text>
			<text>
				<span style={{ fg: colors().text }}>{"Author: "}</span>
				<span style={{ fg: colors().secondary }}>
					{`${props.commit.author} <${props.commit.authorEmail}>`}
				</span>
			</text>
			<text>
				<span style={{ fg: colors().text }}>{"Date:   "}</span>
				<span style={{ fg: colors().secondary }}>
					{formatTimestamp(props.commit.timestamp)}
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
								<text>
									{"    "}
									{line}
								</text>
							)}
						</For>
					</box>
				)}
			</Show>
			<Show when={stats()?.totalFiles ? stats() : undefined}>
				{(s: () => DiffStats) => (
					<box flexDirection="column">
						<FileStats stats={s()} maxWidth={props.maxWidth} />
					</box>
				)}
			</Show>
			<text> </text>
		</box>
	)
}

export function MainArea() {
	const {
		activeCommit,
		commitDetails,
		diff,
		diffLoading,
		diffError,
		diffLineCount,
		viewMode,
		selectedFile,
		bookmarkViewMode,
		selectedBookmarkFile,
	} = useSync()
	const { mainAreaWidth } = useLayout()
	const { colors } = useTheme()
	const focus = useFocus()
	const command = useCommand()

	let scrollRef: ScrollBoxRenderable | undefined

	const [scrollTop, setScrollTop] = createSignal(0)
	const [viewportHeight, setViewportHeight] = createSignal(30)
	const [limit, setLimit] = createSignal(INITIAL_LIMIT)
	const [currentCommitId, setCurrentCommitId] = createSignal<string | null>(
		null,
	)

	// Custom diff renderer state
	const [renderMode, setRenderMode] = createSignal<DiffRenderMode>("custom")
	const [viewStyle, setViewStyle] = createSignal<DiffViewStyle>("unified")

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

	// Fetch parsed diff when commit/file changes and we're in custom mode
	createEffect(() => {
		const commit = activeCommit()
		const mode = renderMode()
		const vMode = viewMode()
		const bmMode = bookmarkViewMode()
		const focusedPanel = focus.panel()

		if (!commit || mode !== "custom") return

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

		// Generate cache key to prevent duplicate fetches
		const fetchKey = `${commit.changeId}:${paths?.join(",") ?? "all"}`
		if (fetchKey === currentFetchKey) return
		currentFetchKey = fetchKey

		setParsedDiffLoading(true)
		setParsedDiffError(null)

		const fetchStart = performance.now()
		fetchParsedDiff(commit.changeId, { paths })
			.then((files) => {
				// Only update if this is still the current fetch
				if (currentFetchKey === fetchKey) {
					const flattened = flattenDiff(files)
					const lineCount = flattened.reduce(
						(sum, f) => sum + f.hunks.reduce((s, h) => s + h.lines.length, 0),
						0,
					)
					profileLog("diff-fetch-complete", {
						fetchMs: Math.round(performance.now() - fetchStart),
						files: flattened.length,
						lines: lineCount,
					})
					setParsedFiles(flattened)
					setParsedDiffLoading(false)
				}
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
			setLimit(INITIAL_LIMIT)
			scrollRef?.scrollTo(0)
			// Reset navigation when switching commits (keep stale content for SWR)
			setActiveFileIndex(0)
			setActiveHunkIndex(0)
		}
	})

	const loadMoreIfNeeded = () => {
		if (!scrollRef) return
		const viewportHeight = scrollRef.viewport?.height ?? 30
		const scrollHeight = scrollRef.scrollHeight ?? 0
		const currentScroll = scrollRef.scrollTop ?? 0

		const distanceFromBottom = scrollHeight - (currentScroll + viewportHeight)
		if (distanceFromBottom < LOAD_THRESHOLD && limit() < diffLineCount()) {
			setLimit((l) => Math.min(l + LIMIT_INCREMENT, diffLineCount()))
		}
	}

	onMount(() => {
		const pollInterval = setInterval(() => {
			if (scrollRef) {
				const currentScroll = scrollRef.scrollTop ?? 0
				const currentViewport = scrollRef.viewport?.height ?? 30
				if (currentScroll !== scrollTop() || currentViewport !== viewportHeight()) {
					setViewportHeight(currentViewport)
					setScrollTop(currentScroll)
					loadMoreIfNeeded()
				}
			}
		}, 100)
		onCleanup(() => clearInterval(pollInterval))
	})

	const isFocused = () => focus.isPanel("detail")

	command.register(() => [
		{
			id: "detail.page_up",
			title: "Page up",
			keybind: "nav_page_up",
			context: "detail",
			type: "navigation",
			onSelect: () => scrollRef?.scrollBy(-0.5, "viewport"),
		},
		{
			id: "detail.page_down",
			title: "Page down",
			keybind: "nav_page_down",
			context: "detail",
			type: "navigation",
			onSelect: () => {
				scrollRef?.scrollBy(0.5, "viewport")
				loadMoreIfNeeded()
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
				loadMoreIfNeeded()
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
			id: "detail.toggle_diff_renderer",
			title: "toggle diff view",
			keybind: "toggle_diff_view",
			context: "detail",
			type: "view",
			visibility: "all",
			onSelect: () => {
				setRenderMode((m) => (m === "passthrough" ? "custom" : "passthrough"))
			},
		},
		{
			id: "detail.toggle_diff_style",
			title: "toggle split/unified",
			keybind: "toggle_diff_style",
			context: "detail",
			type: "view",
			visibility: "help-only",
			onSelect: () => {
				if (renderMode() === "custom") {
					setViewStyle((s) => (s === "unified" ? "split" : "unified"))
				}
			},
		},
		// Navigation commands (only work in custom render mode)
		{
			id: "detail.prev_hunk",
			title: "previous hunk",
			keybind: "nav_prev_hunk",
			context: "detail",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				if (renderMode() === "custom") {
					navigateHunk(-1)
				}
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
				if (renderMode() === "custom") {
					navigateHunk(1)
				}
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
				if (renderMode() === "custom") {
					navigateFile(-1)
				}
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
				if (renderMode() === "custom") {
					navigateFile(1)
				}
			},
		},
	])

	return (
		<Panel title="Detail" hotkey="3" panelId="detail" focused={isFocused()}>
			<Show when={diffLoading() && !diff()}>
				<text>Loading diff...</text>
			</Show>
			<Show when={diffError()}>
				<text>Error: {diffError()}</text>
			</Show>
			<Show when={diff() || (!diffLoading() && !diffError())}>
				<scrollbox
					ref={scrollRef}
					focused={isFocused()}
					flexGrow={1}
					scrollbarOptions={{
						trackOptions: {
							backgroundColor: colors().scrollbarTrack,
							foregroundColor: colors().scrollbarThumb,
						},
					}}
				>
					<Show when={activeCommit()}>
						{(commit: () => Commit) => (
							<CommitHeader
								commit={commit()}
								details={commitDetails()}
								maxWidth={mainAreaWidth()}
							/>
						)}
					</Show>
					<Show when={renderMode() === "passthrough"}>
						<Show when={diff()}>
							<ghostty-terminal
								ansi={diff() ?? ""}
								cols={mainAreaWidth()}
								limit={limit()}
							/>
						</Show>
						<Show when={!diff()}>
							<text>No changes in this commit.</text>
						</Show>
					</Show>
					<Show when={renderMode() === "custom"}>
						<Show when={parsedDiffError()}>
							<text fg={colors().error}>Error: {parsedDiffError()}</text>
						</Show>
						<Show when={!parsedDiffError()}>
							<Show when={parsedDiffLoading() && parsedFiles().length === 0}>
								<text fg={colors().textMuted}>Parsing diff...</text>
							</Show>
							<Show when={parsedFiles().length > 0}>
								<FileSummary
									files={parsedFiles()}
									activeFileId={activeFileId()}
								/>
								<Show when={viewStyle() === "unified"}>
									<VirtualizedUnifiedView
										files={parsedFiles()}
										activeFileId={null}
										currentHunkId={activeHunkId()}
										scrollTop={scrollTop()}
										viewportHeight={viewportHeight()}
									/>
								</Show>
								<Show when={viewStyle() === "split"}>
									<VirtualizedSplitView
										files={parsedFiles()}
										activeFileId={null}
										currentHunkId={activeHunkId()}
										width={mainAreaWidth()}
										scrollTop={scrollTop()}
										viewportHeight={viewportHeight()}
									/>
								</Show>
							</Show>
							<Show when={parsedFiles().length === 0 && !diffLoading()}>
								<text>No changes in this commit.</text>
							</Show>
						</Show>
					</Show>
				</scrollbox>
			</Show>
		</Panel>
	)
}
