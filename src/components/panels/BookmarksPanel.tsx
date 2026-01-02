import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Match, Show, Switch, createEffect, createSignal } from "solid-js"
import {
	type OperationResult,
	isImmutableError,
	jjAbandon,
	jjDescribe,
	jjEdit,
	jjNew,
	jjShowDescription,
	jjSquash,
} from "../../commander/operations"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useLoading } from "../../context/loading"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { Panel } from "../Panel"
import { DescribeModal } from "../modals/DescribeModal"

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
	const commandLog = useCommandLog()
	const dialog = useDialog()
	const globalLoading = useLoading()
	const { colors } = useTheme()
	const { loadLog, loadBookmarks } = useSync()

	const runOperation = async (
		text: string,
		op: () => Promise<OperationResult>,
	) => {
		const result = await globalLoading.run(text, op)
		commandLog.addEntry(result)
		if (result.success) {
			loadLog()
			loadBookmarks()
		}
	}

	const statusColors = () => ({
		added: colors().success,
		modified: colors().warning,
		deleted: colors().error,
		renamed: colors().info,
		copied: colors().info,
	})

	const isFocused = () => focus.isPanel("refs")
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
					id: "refs.bookmarks.revisions.files.next",
					title: "Next file",
					keybind: "nav_down",
					context: "refs.bookmarks.revisions.files",
					type: "navigation",
					panel: "refs",
					hidden: true,
					onSelect: selectNextBookmarkFile,
				},
				{
					id: "refs.bookmarks.revisions.files.prev",
					title: "Previous file",
					keybind: "nav_up",
					context: "refs.bookmarks.revisions.files",
					type: "navigation",
					panel: "refs",
					hidden: true,
					onSelect: selectPrevBookmarkFile,
				},
				{
					id: "refs.bookmarks.revisions.files.toggle",
					title: "Toggle folder",
					keybind: "enter",
					context: "refs.bookmarks.revisions.files",
					type: "action",
					panel: "refs",
					hidden: true,
					onSelect: handleFilesEnter,
				},
				{
					id: "refs.bookmarks.revisions.files.back",
					title: "Back to revisions",
					keybind: "escape",
					context: "refs.bookmarks.revisions.files",
					type: "view",
					panel: "refs",
					hidden: true,
					onSelect: exitBookmarkView,
				},
			]
		}

		if (mode === "commits") {
			return [
				{
					id: "refs.bookmarks.revisions.next",
					title: "Next revision",
					keybind: "nav_down",
					context: "refs.bookmarks.revisions",
					type: "navigation",
					panel: "refs",
					hidden: true,
					onSelect: selectNextBookmarkCommit,
				},
				{
					id: "refs.bookmarks.revisions.prev",
					title: "Previous revision",
					keybind: "nav_up",
					context: "refs.bookmarks.revisions",
					type: "navigation",
					panel: "refs",
					hidden: true,
					onSelect: selectPrevBookmarkCommit,
				},
				{
					id: "refs.bookmarks.revisions.view_files",
					title: "View files",
					keybind: "enter",
					context: "refs.bookmarks.revisions",
					type: "view",
					panel: "refs",
					hidden: true,
					onSelect: handleCommitsEnter,
				},
				{
					id: "refs.bookmarks.revisions.back",
					title: "Back to bookmarks",
					keybind: "escape",
					context: "refs.bookmarks.revisions",
					type: "view",
					panel: "refs",
					hidden: true,
					onSelect: exitBookmarkView,
				},
				{
					id: "refs.bookmarks.revisions.new",
					title: "New",
					keybind: "jj_new",
					context: "refs.bookmarks.revisions",
					type: "action",
					panel: "refs",
					onSelect: () => {
						const commit = selectedBookmarkCommit()
						if (commit)
							runOperation("Creating...", () => jjNew(commit.changeId))
					},
				},
				{
					id: "refs.bookmarks.revisions.edit",
					title: "Edit",
					keybind: "jj_edit",
					context: "refs.bookmarks.revisions",
					type: "action",
					panel: "refs",
					onSelect: () => {
						const commit = selectedBookmarkCommit()
						if (commit)
							runOperation("Editing...", () => jjEdit(commit.changeId))
					},
				},
				{
					id: "refs.bookmarks.revisions.squash",
					title: "Squash",
					keybind: "jj_squash",
					context: "refs.bookmarks.revisions",
					type: "action",
					panel: "refs",
					onSelect: async () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return
						const result = await jjSquash(commit.changeId)
						if (isImmutableError(result)) {
							const confirmed = await dialog.confirm({
								message: "Parent is immutable. Squash anyway?",
							})
							if (confirmed) {
								await runOperation("Squashing...", () =>
									jjSquash(commit.changeId, { ignoreImmutable: true }),
								)
							}
						} else {
							commandLog.addEntry(result)
							if (result.success) {
								loadLog()
								loadBookmarks()
							}
						}
					},
				},
				{
					id: "refs.bookmarks.revisions.describe",
					title: "Describe",
					keybind: "jj_describe",
					context: "refs.bookmarks.revisions",
					type: "action",
					panel: "refs",
					onSelect: async () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return

						let ignoreImmutable = false
						if (commit.immutable) {
							const confirmed = await dialog.confirm({
								message: "Commit is immutable. Describe anyway?",
							})
							if (!confirmed) return
							ignoreImmutable = true
						}

						const desc = await jjShowDescription(commit.changeId)
						dialog.open(
							() => (
								<DescribeModal
									initialSubject={desc.subject}
									initialBody={desc.body}
									onSave={(subject, body) => {
										const message = body ? `${subject}\n\n${body}` : subject
										runOperation("Describing...", () =>
											jjDescribe(commit.changeId, message, { ignoreImmutable }),
										)
									}}
								/>
							),
							{ id: "describe" },
						)
					},
				},
				{
					id: "refs.bookmarks.revisions.abandon",
					title: "Abandon",
					keybind: "jj_abandon",
					context: "refs.bookmarks.revisions",
					type: "action",
					panel: "refs",
					onSelect: async () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return
						const confirmed = await dialog.confirm({
							message: `Abandon change ${commit.changeId.slice(0, 8)}?`,
						})
						if (confirmed) {
							await runOperation("Abandoning...", () =>
								jjAbandon(commit.changeId),
							)
						}
					},
				},
			]
		}

		return [
			{
				id: "refs.bookmarks.next",
				title: "Next bookmark",
				keybind: "nav_down",
				context: "refs.bookmarks",
				type: "navigation",
				panel: "refs",
				hidden: true,
				onSelect: selectNextBookmark,
			},
			{
				id: "refs.bookmarks.prev",
				title: "Previous bookmark",
				keybind: "nav_up",
				context: "refs.bookmarks",
				type: "navigation",
				panel: "refs",
				hidden: true,
				onSelect: selectPrevBookmark,
			},
			{
				id: "refs.bookmarks.view_revisions",
				title: "View revisions",
				keybind: "enter",
				context: "refs.bookmarks",
				type: "view",
				panel: "refs",
				hidden: true,
				onSelect: handleListEnter,
			},
		]
	})

	return (
		<Panel title={title()} hotkey="2" focused={isFocused()}>
			<Switch>
				<Match when={bookmarkViewMode() === "list"}>
					<Show when={bookmarksLoading() && localBookmarks().length === 0}>
						<text fg={colors().textMuted}>Loading bookmarks...</text>
					</Show>
					<Show when={bookmarksError() && localBookmarks().length === 0}>
						<text fg={colors().error}>Error: {bookmarksError()}</text>
					</Show>
					<Show
						when={localBookmarks().length > 0}
						fallback={
							!bookmarksLoading() && !bookmarksError() ? (
								<text fg={colors().textMuted}>No bookmarks</text>
							) : null
						}
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
												isSelected() ? colors().selectionBackground : undefined
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
