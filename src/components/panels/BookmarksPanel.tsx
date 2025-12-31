import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Match, Show, Switch, createEffect, createSignal } from "solid-js"
import { useCommand } from "../../context/command"
import { useFocus } from "../../context/focus"
import { useSync } from "../../context/sync"
import { colors } from "../../theme"

const STATUS_COLORS: Record<string, string> = {
	added: colors.success,
	modified: colors.warning,
	deleted: colors.error,
	renamed: colors.info,
	copied: colors.info,
}

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
		selectFirstBookmark,
		selectLastBookmark,
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
		selectFirstBookmarkCommit,
		selectLastBookmarkCommit,
		selectPrevBookmarkFile,
		selectNextBookmarkFile,
		selectFirstBookmarkFile,
		selectLastBookmarkFile,
		toggleBookmarkFolder,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()

	const isFocused = () => focus.is("bookmarks")
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
			return commit ? `[2] Files (${commit.changeId.slice(0, 8)})` : "[2] Files"
		}
		if (mode === "commits") {
			return `[2] Commits (${activeBookmarkName()})`
		}
		return "[2] Bookmarks"
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
					context: "bookmarks",
					category: "Navigation",
					onSelect: selectNextBookmarkFile,
				},
				{
					id: "bookmark_files.prev",
					title: "Previous file",
					keybind: "nav_up",
					context: "bookmarks",
					category: "Navigation",
					onSelect: selectPrevBookmarkFile,
				},
				{
					id: "bookmark_files.first",
					title: "First file",
					keybind: "nav_first",
					context: "bookmarks",
					category: "Navigation",
					onSelect: selectFirstBookmarkFile,
				},
				{
					id: "bookmark_files.last",
					title: "Last file",
					keybind: "nav_last",
					context: "bookmarks",
					category: "Navigation",
					onSelect: selectLastBookmarkFile,
				},
				{
					id: "bookmark_files.toggle",
					title: "Toggle folder",
					keybind: "enter",
					context: "bookmarks",
					category: "Files",
					onSelect: handleFilesEnter,
				},
				{
					id: "bookmark_files.back",
					title: "Back to commits",
					keybind: "escape",
					context: "bookmarks",
					category: "Navigation",
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
					context: "bookmarks",
					category: "Navigation",
					onSelect: selectNextBookmarkCommit,
				},
				{
					id: "bookmark_commits.prev",
					title: "Previous commit",
					keybind: "nav_up",
					context: "bookmarks",
					category: "Navigation",
					onSelect: selectPrevBookmarkCommit,
				},
				{
					id: "bookmark_commits.first",
					title: "First commit",
					keybind: "nav_first",
					context: "bookmarks",
					category: "Navigation",
					onSelect: selectFirstBookmarkCommit,
				},
				{
					id: "bookmark_commits.last",
					title: "Last commit",
					keybind: "nav_last",
					context: "bookmarks",
					category: "Navigation",
					onSelect: selectLastBookmarkCommit,
				},
				{
					id: "bookmark_commits.enter",
					title: "View files",
					keybind: "enter",
					context: "bookmarks",
					category: "Bookmarks",
					onSelect: handleCommitsEnter,
				},
				{
					id: "bookmark_commits.back",
					title: "Back to bookmarks",
					keybind: "escape",
					context: "bookmarks",
					category: "Navigation",
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
				category: "Navigation",
				onSelect: selectNextBookmark,
			},
			{
				id: "bookmarks.prev",
				title: "Previous bookmark",
				keybind: "nav_up",
				context: "bookmarks",
				category: "Navigation",
				onSelect: selectPrevBookmark,
			},
			{
				id: "bookmarks.first",
				title: "First bookmark",
				keybind: "nav_first",
				context: "bookmarks",
				category: "Navigation",
				onSelect: selectFirstBookmark,
			},
			{
				id: "bookmarks.last",
				title: "Last bookmark",
				keybind: "nav_last",
				context: "bookmarks",
				category: "Navigation",
				onSelect: selectLastBookmark,
			},
			{
				id: "bookmarks.enter",
				title: "View commits",
				keybind: "enter",
				context: "bookmarks",
				category: "Bookmarks",
				onSelect: handleListEnter,
			},
		]
	})

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			height="100%"
			border
			borderColor={isFocused() ? colors.borderFocused : colors.border}
			overflow="hidden"
			gap={0}
		>
			<box backgroundColor={colors.backgroundSecondary}>
				<text fg={isFocused() ? colors.primary : colors.textMuted}>
					{title()}
				</text>
			</box>

			<Switch>
				<Match when={bookmarkViewMode() === "list"}>
					<Show when={bookmarksLoading()}>
						<text fg={colors.textMuted}>Loading bookmarks...</text>
					</Show>
					<Show when={bookmarksError()}>
						<text fg={colors.error}>Error: {bookmarksError()}</text>
					</Show>
					<Show when={!bookmarksLoading() && !bookmarksError()}>
						<Show
							when={localBookmarks().length > 0}
							fallback={<text fg={colors.textMuted}>No bookmarks</text>}
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
													isSelected() ? colors.selectionBackground : undefined
												}
												overflow="hidden"
											>
												<text>
													<span style={{ fg: colors.primary }}>
														{bookmark.name}
													</span>
													<span style={{ fg: colors.textMuted }}>
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
						<text fg={colors.textMuted}>Loading commits...</text>
					</Show>
					<Show when={!bookmarkCommitsLoading()}>
						<Show
							when={bookmarkCommits().length > 0}
							fallback={<text fg={colors.textMuted}>No commits</text>}
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
													isSelected() ? colors.selectionBackground : undefined
												}
												overflow="hidden"
											>
												<text wrapMode="none">
													<span
														style={{
															fg: commit.isWorkingCopy
																? colors.primary
																: colors.textMuted,
														}}
													>
														{icon}{" "}
													</span>
													<span style={{ fg: colors.warning }}>
														{commit.changeId.slice(0, 8)}
													</span>
													<span style={{ fg: colors.text }}>
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
						<text fg={colors.textMuted}>Loading files...</text>
					</Show>
					<Show when={!bookmarkFilesLoading()}>
						<Show
							when={bookmarkFlatFiles().length > 0}
							fallback={<text fg={colors.textMuted}>No files</text>}
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
											? STATUS_COLORS[node.status]
											: colors.text

										return (
											<box
												backgroundColor={
													isSelected() ? colors.selectionBackground : undefined
												}
												overflow="hidden"
											>
												<text>
													<span style={{ fg: colors.textMuted }}>{indent}</span>
													<span
														style={{
															fg: node.isDirectory
																? colors.info
																: colors.textMuted,
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
															fg: node.isDirectory ? colors.info : colors.text,
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
		</box>
	)
}
