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
import { type CommitDetails, useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { AnsiText } from "../AnsiText"
import { Panel } from "../Panel"

const INITIAL_LIMIT = 1000
const LIMIT_INCREMENT = 200
const LOAD_THRESHOLD = 200

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
	} = useSync()
	const { mainAreaWidth } = useLayout()
	const { colors } = useTheme()
	const focus = useFocus()
	const command = useCommand()

	let scrollRef: ScrollBoxRenderable | undefined

	const [scrollTop, setScrollTop] = createSignal(0)
	const [limit, setLimit] = createSignal(INITIAL_LIMIT)
	const [currentCommitId, setCurrentCommitId] = createSignal<string | null>(
		null,
	)

	createEffect(() => {
		const commit = activeCommit()
		if (commit && commit.changeId !== currentCommitId()) {
			setCurrentCommitId(commit.changeId)
			setScrollTop(0)
			setLimit(INITIAL_LIMIT)
			scrollRef?.scrollTo(0)
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
				if (currentScroll !== scrollTop()) {
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
				</scrollbox>
			</Show>
		</Panel>
	)
}
