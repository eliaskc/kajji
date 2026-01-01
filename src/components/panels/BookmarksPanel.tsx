import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Match, Show, Switch, createEffect, createSignal } from "solid-js"
import { useCommand } from "../../context/command"
import { useFocus } from "../../context/focus"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { Panel } from "../Panel"

const STATUS_CHARS: Record<string, string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
	copied: "C",
}

export function BookmarksPanel() {
	const {
		bookmarks,
		selectedBookmarkIndex,
		bookmarksLoading,
		bookmarksError,
		selectNextBookmark,
		selectPrevBookmark,
		bookmarkViewMode,
		bookmarkCommits,
		selectedBookmarkCommitIndex,
		bookmarkCommitsLoading,
		bookmarkFlatFiles,
		selectedBookmarkFileIndex,
		bookmarkFilesLoading,
		bookmarkCollapsedPaths,
		activeBookmarkName,
		selectedBookmarkCommit,
		enterBookmarkCommitsView,
		enterBookmarkFilesView,
		exitBookmarkView,
		selectPrevBookmarkCommit,
		selectNextBookmarkCommit,
		selectPrevBookmarkFile,
		selectNextBookmarkFile,
		toggleBookmarkFolder,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const { colors } = useTheme()

	const statusColors = () => ({
		added: colors().success,
		modified: colors().warning,
		deleted: colors().error,
		renamed: colors().info,
		copied: colors().info,
	})

	const isFocused = () => focus.isPanel("bookmarks")
	const localBookmarks = () => bookmarks().filter((b) => b.isLocal)

	let listScrollRef: ScrollBoxRenderable | undefined
	let commitsScrollRef: ScrollBoxRenderable | undefined
	let filesScrollRef: ScrollBoxRenderable | undefined

	const [listScrollTop, setListScrollTop] = createSignal(0)
	const [commitsScrollTop, setCommitsScrollTop] = createSignal(0)
	const [filesScrollTop, setFilesScrollTop] = createSignal(0)

	const scrollIntoView = (
		ref: ScrollBoxRenderable | undefined,
		index: number,
		scrollTop: number,
		setScrollTop: (n: number) => void,
		listLength: number,
	) => {
		if (!ref || listLength === 0) return
		const margin = 2
		const refAny = ref as unknown as Record<string, unknown>
		const viewportHeight =
			(typeof refAny.height === "number" ? refAny.height : null) ??
			(typeof refAny.rows === "number" ? refAny.rows : null) ??
			10

		const visibleStart = scrollTop
		const visibleEnd = scrollTop + viewportHeight - 1
		const safeStart = visibleStart + margin
		const safeEnd = visibleEnd - margin

		let newScrollTop = scrollTop
		if (index < safeStart) {
			newScrollTop = Math.max(0, index - margin)
		} else if (index > safeEnd) {
			newScrollTop = Math.max(0, index - viewportHeight + margin + 1)
		}

		if (newScrollTop !== scrollTop) {
			ref.scrollTo(newScrollTop)
			setScrollTop(newScrollTop)
		}
	}

	createEffect(() => {
		const index = selectedBookmarkIndex()
		scrollIntoView(
			listScrollRef,
			index,
			listScrollTop(),
			setListScrollTop,
			localBookmarks().length,
		)
	})

	createEffect(() => {
		const index = selectedBookmarkCommitIndex()
		scrollIntoView(
			commitsScrollRef,
			index,
			commitsScrollTop(),
			setCommitsScrollTop,
			bookmarkCommits().length,
		)
	})

	createEffect(() => {
		const index = selectedBookmarkFileIndex()
		scrollIntoView(
			filesScrollRef,
			index,
			filesScrollTop(),
			setFilesScrollTop,
			bookmarkFlatFiles().length,
		)
	})

	const title = () => {
		const mode = bookmarkViewMode()
		if (mode === "files") {
			const commit = selectedBookmarkCommit()
			return commit ? `Files (${commit.changeId.slice(0, 8)})` : "Files"
		}
		if (mode === "commits") {
			return `Commits (${activeBookmarkName()})`
		}
		return "Bookmarks"
	}

	const handleListEnter = () => {
		enterBookmarkCommitsView()
	}

	const handleCommitsEnter = () => {
		enterBookmarkFilesView()
	}

	const handleFilesEnter = () => {
		const file = bookmarkFlatFiles()[selectedBookmarkFileIndex()]
		if (file?.node.isDirectory) {
			toggleBookmarkFolder(file.node.path)
		}
	}

	command.register(() => {
		const mode = bookmarkViewMode()

		if (mode === "files") {
			return [
				{
					id: "bookmark_files.next",
					title: "Next file",
					keybind: "nav_down",
					context: "files",
					type: "navigation",
					panel: "bookmarks",
					hidden: true,
					onSelect: selectNextBookmarkFile,
				},
				{
					id: "bookmark_files.prev",
					title: "Previous file",
					keybind: "nav_up",
					context: "files",
					type: "navigation",
					panel: "bookmarks",
					hidden: true,
					onSelect: selectPrevBookmarkFile,
				},
				{
					id: "bookmark_files.toggle",
					title: "Toggle folder",
					keybind: "enter",
					context: "files",
					type: "action",
					panel: "bookmarks",
					hidden: true,
					onSelect: handleFilesEnter,
				},
				{
					id: "bookmark_files.back",
					title: "Back to commits",
					keybind: "escape",
					context: "files",
					type: "view",
					panel: "bookmarks",
					hidden: true,
					onSelect: exitBookmarkView,
				},
			]
		}

		if (mode === "commits") {
			return [
				{
					id: "bookmark_commits.next",
					title: "Next commit",
					keybind: "nav_down",
					context: "commits",
					type: "navigation",
					panel: "bookmarks",
					hidden: true,
					onSelect: selectNextBookmarkCommit,
				},
				{
					id: "bookmark_commits.prev",
					title: "Previous commit",
					keybind: "nav_up",
					context: "commits",
					type: "navigation",
					panel: "bookmarks",
					hidden: true,
					onSelect: selectPrevBookmarkCommit,
				},
				{
					id: "bookmark_commits.view_files",
					title: "View files",
					keybind: "enter",
					context: "commits",
					type: "view",
					panel: "bookmarks",
					hidden: true,
					onSelect: handleCommitsEnter,
				},
				{
					id: "bookmark_commits.back",
					title: "Back to bookmarks",
					keybind: "escape",
					context: "commits",
					type: "view",
					panel: "bookmarks",
					hidden: true,
					onSelect: exitBookmarkView,
				},
			]
		}

		return [
			{
				id: "bookmarks.next",
				title: "Next bookmark",
				keybind: "nav_down",
				context: "bookmarks",
				type: "navigation",
				panel: "bookmarks",
				hidden: true,
				onSelect: selectNextBookmark,
			},
			{
				id: "bookmarks.prev",
				title: "Previous bookmark",
				keybind: "nav_up",
				context: "bookmarks",
				type: "navigation",
				panel: "bookmarks",
				hidden: true,
				onSelect: selectPrevBookmark,
			},
			{
				id: "bookmarks.view_commits",
				title: "View commits",
				keybind: "enter",
				context: "bookmarks",
				type: "view",
				panel: "bookmarks",
				hidden: true,
				onSelect: handleListEnter,
			},
		]
	})

	return (
		<Panel title={title()} hotkey="2" focused={isFocused()}>
			<Switch>
				<Match when={bookmarkViewMode() === "list"}>
					<Show when={bookmarksLoading()}>
						<text fg={colors().textMuted}>Loading bookmarks...</text>
					</Show>
					<Show when={bookmarksError()}>
						<text fg={colors().error}>Error: {bookmarksError()}</text>
					</Show>
					<Show when={!bookmarksLoading() && !bookmarksError()}>
						<Show
							when={localBookmarks().length > 0}
							fallback={<text fg={colors().textMuted}>No bookmarks</text>}
						>
							<scrollbox
								ref={listScrollRef}
								flexGrow={1}
								scrollbarOptions={{ visible: false }}
							>
								<For each={localBookmarks()}>
									{(bookmark, index) => {
										const isSelected = () => index() === selectedBookmarkIndex()
										return (
											<box
												backgroundColor={
													isSelected()
														? colors().selectionBackground
														: undefined
												}
												overflow="hidden"
											>
												<text>
													<span style={{ fg: colors().primary }}>
														{bookmark.name}
													</span>
													<span style={{ fg: colors().textMuted }}>
														{" "}
														{bookmark.changeId.slice(0, 8)}
													</span>
												</text>
											</box>
										)
									}}
								</For>
							</scrollbox>
						</Show>
					</Show>
				</Match>

				<Match when={bookmarkViewMode() === "commits"}>
					<Show when={bookmarkCommitsLoading()}>
						<text fg={colors().textMuted}>Loading commits...</text>
					</Show>
					<Show when={!bookmarkCommitsLoading()}>
						<Show
							when={bookmarkCommits().length > 0}
							fallback={<text fg={colors().textMuted}>No commits</text>}
						>
							<scrollbox
								ref={commitsScrollRef}
								flexGrow={1}
								scrollbarOptions={{ visible: false }}
							>
								<For each={bookmarkCommits()}>
									{(commit, index) => {
										const isSelected = () =>
											index() === selectedBookmarkCommitIndex()
										const icon = commit.isWorkingCopy ? "◆" : "○"
										return (
											<box
												backgroundColor={
													isSelected()
														? colors().selectionBackground
														: undefined
												}
												overflow="hidden"
											>
												<text wrapMode="none">
													<span
														style={{
															fg: commit.isWorkingCopy
																? colors().primary
																: colors().textMuted,
														}}
													>
														{icon}{" "}
													</span>
													<span style={{ fg: colors().warning }}>
														{commit.changeId.slice(0, 8)}
													</span>
													<span style={{ fg: colors().text }}>
														{" "}
														{commit.description}
													</span>
												</text>
											</box>
										)
									}}
								</For>
							</scrollbox>
						</Show>
					</Show>
				</Match>

				<Match when={bookmarkViewMode() === "files"}>
					<Show when={bookmarkFilesLoading()}>
						<text fg={colors().textMuted}>Loading files...</text>
					</Show>
					<Show when={!bookmarkFilesLoading()}>
						<Show
							when={bookmarkFlatFiles().length > 0}
							fallback={<text fg={colors().textMuted}>No files</text>}
						>
							<scrollbox
								ref={filesScrollRef}
								flexGrow={1}
								scrollbarOptions={{ visible: false }}
							>
								<For each={bookmarkFlatFiles()}>
									{(item, index) => {
										const isSelected = () =>
											index() === selectedBookmarkFileIndex()
										const node = item.node
										const indent = "  ".repeat(item.visualDepth)
										const isCollapsed = bookmarkCollapsedPaths().has(node.path)

										const icon = node.isDirectory
											? isCollapsed
												? "▶"
												: "▼"
											: " "

										const statusChar = node.status
											? (STATUS_CHARS[node.status] ?? " ")
											: " "
										const statusColor = node.status
											? (statusColors()[
													node.status as keyof ReturnType<typeof statusColors>
												] ?? colors().text)
											: colors().text

										return (
											<box
												backgroundColor={
													isSelected()
														? colors().selectionBackground
														: undefined
												}
												overflow="hidden"
											>
												<text>
													<span style={{ fg: colors().textMuted }}>
														{indent}
													</span>
													<span
														style={{
															fg: node.isDirectory
																? colors().info
																: colors().textMuted,
														}}
													>
														{icon}{" "}
													</span>
													<Show when={!node.isDirectory}>
														<span style={{ fg: statusColor }}>
															{statusChar}{" "}
														</span>
													</Show>
													<span
														style={{
															fg: node.isDirectory
																? colors().info
																: colors().text,
														}}
													>
														{node.name}
													</span>
												</text>
											</box>
										)
									}}
								</For>
							</scrollbox>
						</Show>
					</Show>
				</Match>
			</Switch>
		</Panel>
	)
}
