import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
	For,
	Match,
	Show,
	Switch,
	createEffect,
	createSignal,
	on,
} from "solid-js"
import {
	jjBookmarkCreate,
	jjBookmarkDelete,
	jjBookmarkForget,
	jjBookmarkRename,
	jjBookmarkSet,
} from "../../commander/bookmarks"
import {
	type OperationResult,
	isImmutableError,
	jjAbandon,
	jjDescribe,
	jjEdit,
	jjNew,
	jjRebase,
	jjRestore,
	jjShowDescription,
	jjSplitInteractive,
	jjSquash,
} from "../../commander/operations"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useLoading } from "../../context/loading"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { createDoubleClickDetector } from "../../utils/double-click"
import { FileTreeList } from "../FileTreeList"
import { Panel } from "../Panel"
import { BookmarkNameModal } from "../modals/BookmarkNameModal"
import { DescribeModal } from "../modals/DescribeModal"
import { RevisionPickerModal } from "../modals/RevisionPickerModal"
import { SetBookmarkModal } from "../modals/SetBookmarkModal"

export function BookmarksPanel() {
	const renderer = useRenderer()
	const {
		commits,
		bookmarks,
		selectedBookmarkIndex,
		setSelectedBookmarkIndex,
		selectedBookmark,
		bookmarksLoading,
		bookmarksError,
		selectNextBookmark,
		selectPrevBookmark,
		bookmarkViewMode,
		bookmarkCommits,
		selectedBookmarkCommitIndex,
		setSelectedBookmarkCommitIndex,
		bookmarkCommitsLoading,
		bookmarkFlatFiles,
		selectedBookmarkFileIndex,
		setSelectedBookmarkFileIndex,
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
	const { refresh } = useSync()

	const runOperation = async (
		text: string,
		op: () => Promise<OperationResult>,
	) => {
		const result = await globalLoading.run(text, op)
		commandLog.addEntry(result)
		if (result.success) {
			refresh()
		}
	}

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
		const viewportHeight = ref.viewport?.height ?? 30

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

	createEffect(
		on(selectedBookmarkIndex, (index) => {
			scrollIntoView(
				listScrollRef,
				index,
				listScrollTop(),
				setListScrollTop,
				localBookmarks().length,
			)
		}),
	)

	createEffect(
		on(selectedBookmarkCommitIndex, (index) => {
			scrollIntoView(
				commitsScrollRef,
				index,
				commitsScrollTop(),
				setCommitsScrollTop,
				bookmarkCommits().length,
			)
		}),
	)

	createEffect(
		on(selectedBookmarkFileIndex, (index) => {
			scrollIntoView(
				filesScrollRef,
				index,
				filesScrollTop(),
				setFilesScrollTop,
				bookmarkFlatFiles().length,
			)
		}),
	)

	const title = () => {
		const mode = bookmarkViewMode()
		if (mode === "files") {
			const commit = selectedBookmarkCommit()
			return commit ? `Files (${commit.changeId.slice(0, 8)})` : "Files"
		}
		if (mode === "commits") {
			return `Revisions (${activeBookmarkName()})`
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
					id: "refs.files.next",
					title: "next file",
					keybind: "nav_down",
					context: "refs.files",
					type: "navigation",
					panel: "refs",
					visibility: "help-only",
					onSelect: selectNextBookmarkFile,
				},
				{
					id: "refs.files.prev",
					title: "previous file",
					keybind: "nav_up",
					context: "refs.files",
					type: "navigation",
					panel: "refs",
					visibility: "help-only",
					onSelect: selectPrevBookmarkFile,
				},
				{
					id: "refs.files.toggle",
					title: "toggle folder",
					keybind: "enter",
					context: "refs.files",
					type: "action",
					panel: "refs",
					visibility: "help-only",
					onSelect: handleFilesEnter,
				},
				{
					id: "refs.files.back",
					title: "back",
					keybind: "escape",
					context: "refs.files",
					type: "view",
					panel: "refs",
					visibility: "help-only",
					onSelect: exitBookmarkView,
				},
				{
					id: "refs.files.restore",
					title: "restore",
					keybind: "jj_restore",
					context: "refs.files",
					type: "action",
					panel: "refs",
					onSelect: async () => {
						const file = bookmarkFlatFiles()[selectedBookmarkFileIndex()]
						if (!file) return
						const node = file.node
						const pathType = node.isDirectory ? "folder" : "file"
						const confirmed = await dialog.confirm({
							message: `Restore ${pathType} "${node.path}"? This will discard changes.`,
						})
						if (confirmed) {
							await runOperation("Restoring...", () => jjRestore([node.path]))
						}
					},
				},
			]
		}

		if (mode === "commits") {
			return [
				{
					id: "refs.revisions.next",
					title: "down",
					keybind: "nav_down",
					context: "refs.revisions",
					type: "navigation",
					panel: "refs",
					visibility: "help-only",
					onSelect: selectNextBookmarkCommit,
				},
				{
					id: "refs.revisions.prev",
					title: "up",
					keybind: "nav_up",
					context: "refs.revisions",
					type: "navigation",
					panel: "refs",
					visibility: "help-only",
					onSelect: selectPrevBookmarkCommit,
				},
				{
					id: "refs.revisions.view_files",
					title: "view files",
					keybind: "enter",
					context: "refs.revisions",
					type: "view",
					panel: "refs",
					visibility: "help-only",
					onSelect: handleCommitsEnter,
				},
				{
					id: "refs.revisions.back",
					title: "back",
					keybind: "escape",
					context: "refs.revisions",
					type: "view",
					panel: "refs",
					visibility: "help-only",
					onSelect: exitBookmarkView,
				},
				{
					id: "refs.revisions.new",
					title: "new",
					keybind: "jj_new",
					context: "refs.revisions",
					type: "action",
					panel: "refs",
					onSelect: () => {
						const commit = selectedBookmarkCommit()
						if (commit)
							runOperation("Creating...", () => jjNew(commit.changeId))
					},
				},
				{
					id: "refs.revisions.edit",
					title: "edit",
					keybind: "jj_edit",
					context: "refs.revisions",
					type: "action",
					panel: "refs",
					onSelect: async () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return
						const result = await jjEdit(commit.changeId)
						if (isImmutableError(result)) {
							const confirmed = await dialog.confirm({
								message: "Commit is immutable. Edit anyway?",
							})
							if (confirmed) {
								await runOperation("Editing...", () =>
									jjEdit(commit.changeId, { ignoreImmutable: true }),
								)
							}
						} else {
							commandLog.addEntry(result)
							if (result.success) {
								refresh()
							}
						}
					},
				},
				{
					id: "refs.revisions.squash",
					title: "squash",
					keybind: "jj_squash",
					context: "refs.revisions",
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
								refresh()
							}
						}
					},
				},
				{
					id: "refs.revisions.rebase",
					title: "rebase",
					keybind: "jj_rebase",
					context: "refs.revisions",
					type: "action",
					panel: "refs",
					onSelect: () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return
						dialog.open(
							() => (
								<RevisionPickerModal
									title={`Rebase ${commit.changeId.slice(0, 8)} onto`}
									commits={commits()}
									defaultRevision={commit.changeId}
									onSelect={async (destination) => {
										const result = await jjRebase(commit.changeId, destination)
										if (isImmutableError(result)) {
											const confirmed = await dialog.confirm({
												message: "Target is immutable. Rebase anyway?",
											})
											if (confirmed) {
												await runOperation("Rebasing...", () =>
													jjRebase(commit.changeId, destination, {
														ignoreImmutable: true,
													}),
												)
											}
										} else {
											commandLog.addEntry(result)
											if (result.success) {
												refresh()
											}
										}
									}}
								/>
							),
							{
								id: "rebase",
								hints: [{ key: "enter", label: "confirm" }],
							},
						)
					},
				},
				{
					id: "refs.revisions.split",
					title: "split",
					keybind: "jj_split",
					context: "refs.revisions",
					type: "action",
					panel: "refs",
					onSelect: async () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return

						if (commit.empty) {
							await dialog.confirm({
								message: "Cannot split an empty commit.",
							})
							return
						}

						renderer.suspend?.()
						try {
							await jjSplitInteractive(commit.changeId)
						} finally {
							renderer.resume?.()
							refresh()
						}
					},
				},
				{
					id: "refs.revisions.describe",
					title: "describe",
					keybind: "jj_describe",
					context: "refs.revisions",
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
							{
								id: "describe",
								hints: [
									{ key: "tab", label: "switch field" },
									{ key: "enter", label: "save" },
								],
							},
						)
					},
				},
				{
					id: "refs.revisions.abandon",
					title: "abandon",
					keybind: "jj_abandon",
					context: "refs.revisions",
					type: "action",
					panel: "refs",
					onSelect: async () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return
						const confirmed = await dialog.confirm({
							message: `Abandon change ${commit.changeId.slice(0, 8)}?`,
						})
						if (!confirmed) return
						const result = await jjAbandon(commit.changeId)
						if (isImmutableError(result)) {
							const immutableConfirmed = await dialog.confirm({
								message: "Commit is immutable. Abandon anyway?",
							})
							if (immutableConfirmed) {
								await runOperation("Abandoning...", () =>
									jjAbandon(commit.changeId, { ignoreImmutable: true }),
								)
							}
						} else {
							commandLog.addEntry(result)
							if (result.success) {
								refresh()
							}
						}
					},
				},
				{
					id: "refs.revisions.set_bookmark",
					title: "set bookmark",
					keybind: "bookmark_set",
					context: "refs.revisions",
					type: "action",
					panel: "refs",
					onSelect: () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return
						dialog.open(
							() => (
								<SetBookmarkModal
									title={`Set bookmark on ${commit.changeId.slice(0, 8)}`}
									bookmarks={localBookmarks()}
									changeId={commit.changeId}
									onMove={(bookmark) => {
										runOperation("Moving bookmark...", () =>
											jjBookmarkSet(bookmark.name, commit.changeId),
										)
									}}
									onCreate={(name) => {
										runOperation("Creating bookmark...", () =>
											jjBookmarkCreate(name, { revision: commit.changeId }),
										)
									}}
								/>
							),
							{
								id: "set-bookmark",
								hints: [
									{ key: "tab", label: "switch" },
									{ key: "enter", label: "confirm" },
								],
							},
						)
					},
				},
			]
		}

		return [
			{
				id: "refs.bookmarks.next",
				title: "down",
				keybind: "nav_down",
				context: "refs.bookmarks",
				type: "navigation",
				panel: "refs",
				visibility: "help-only",
				onSelect: selectNextBookmark,
			},
			{
				id: "refs.bookmarks.prev",
				title: "up",
				keybind: "nav_up",
				context: "refs.bookmarks",
				type: "navigation",
				panel: "refs",
				visibility: "help-only",
				onSelect: selectPrevBookmark,
			},
			{
				id: "refs.bookmarks.view_revisions",
				title: "view revisions",
				keybind: "enter",
				context: "refs.bookmarks",
				type: "view",
				panel: "refs",
				visibility: "help-only",
				onSelect: handleListEnter,
			},
			{
				id: "refs.bookmarks.create",
				title: "create",
				keybind: "bookmark_create",
				context: "refs.bookmarks",
				type: "action",
				panel: "refs",
				onSelect: () => {
					const workingCopy = commits().find((c) => c.isWorkingCopy)
					dialog.open(
						() => (
							<BookmarkNameModal
								title="Create Bookmark"
								commits={commits()}
								defaultRevision={workingCopy?.changeId}
								onSave={(name, revision) => {
									runOperation("Creating bookmark...", () =>
										jjBookmarkCreate(name, { revision }),
									)
								}}
							/>
						),
						{
							id: "bookmark-create",
							hints: [
								{ key: "tab", label: "switch field" },
								{ key: "enter", label: "save" },
							],
						},
					)
				},
			},
			{
				id: "refs.bookmarks.delete",
				title: "delete",
				keybind: "bookmark_delete",
				context: "refs.bookmarks",
				type: "action",
				panel: "refs",
				onSelect: async () => {
					const bookmark = selectedBookmark()
					if (!bookmark) return
					const currentIndex = selectedBookmarkIndex()
					const totalBookmarks = localBookmarks().length
					const confirmed = await dialog.confirm({
						message: `Delete bookmark "${bookmark.name}"?`,
					})
					if (confirmed) {
						await runOperation("Deleting bookmark...", () =>
							jjBookmarkDelete(bookmark.name),
						)
						if (currentIndex >= totalBookmarks - 1 && currentIndex > 0) {
							setSelectedBookmarkIndex(currentIndex - 1)
						}
					}
				},
			},
			{
				id: "refs.bookmarks.rename",
				title: "rename",
				keybind: "bookmark_rename",
				context: "refs.bookmarks",
				type: "action",
				panel: "refs",
				onSelect: () => {
					const bookmark = selectedBookmark()
					if (!bookmark) return
					dialog.open(
						() => (
							<BookmarkNameModal
								title="Rename Bookmark"
								initialValue={bookmark.name}
								onSave={(newName) => {
									runOperation("Renaming bookmark...", () =>
										jjBookmarkRename(bookmark.name, newName),
									)
								}}
							/>
						),
						{
							id: "bookmark-rename",
							hints: [{ key: "enter", label: "save" }],
						},
					)
				},
			},
			{
				id: "refs.bookmarks.forget",
				title: "forget",
				keybind: "bookmark_forget",
				context: "refs.bookmarks",
				type: "action",
				panel: "refs",
				onSelect: async () => {
					const bookmark = selectedBookmark()
					if (!bookmark) return
					const confirmed = await dialog.confirm({
						message: `Forget bookmark "${bookmark.name}"? (local only)`,
					})
					if (confirmed) {
						await runOperation("Forgetting bookmark...", () =>
							jjBookmarkForget(bookmark.name),
						)
					}
				},
			},
			{
				id: "refs.bookmarks.move",
				title: "move",
				keybind: "bookmark_move",
				context: "refs.bookmarks",
				type: "action",
				panel: "refs",
				onSelect: () => {
					const bookmark = selectedBookmark()
					if (!bookmark) return
					dialog.open(
						() => (
							<RevisionPickerModal
								title={`Move "${bookmark.name}" to`}
								commits={commits()}
								defaultRevision={bookmark.changeId}
								onSelect={(revision) => {
									runOperation("Moving bookmark...", () =>
										jjBookmarkSet(bookmark.name, revision),
									)
								}}
							/>
						),
						{
							id: "bookmark-move",
							hints: [{ key: "enter", label: "confirm" }],
						},
					)
				},
			},
		]
	})

	return (
		<Panel title={title()} hotkey="2" panelId="refs" focused={isFocused()}>
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
									const showSelection = () => isSelected() && isFocused()
									const handleDoubleClick = createDoubleClickDetector(() => {
										enterBookmarkCommitsView()
									})
									const handleMouseDown = () => {
										setSelectedBookmarkIndex(index())
										handleDoubleClick()
									}
									return (
										<box
											backgroundColor={
												showSelection()
													? colors().selectionBackground
													: undefined
											}
											overflow="hidden"
											onMouseDown={handleMouseDown}
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
										const showSelection = () => isSelected() && isFocused()
										const icon = commit.isWorkingCopy ? "◆" : "○"
										const handleDoubleClick = createDoubleClickDetector(() => {
											enterBookmarkFilesView()
										})
										const handleMouseDown = () => {
											setSelectedBookmarkCommitIndex(index())
											handleDoubleClick()
										}
										return (
											<box
												backgroundColor={
													showSelection()
														? colors().selectionBackground
														: undefined
												}
												overflow="hidden"
												onMouseDown={handleMouseDown}
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
								<FileTreeList
									files={bookmarkFlatFiles}
									selectedIndex={selectedBookmarkFileIndex}
									setSelectedIndex={setSelectedBookmarkFileIndex}
									collapsedPaths={bookmarkCollapsedPaths}
									toggleFolder={toggleBookmarkFolder}
									isFocused={isFocused}
								/>
							</scrollbox>
						</Show>
					</Show>
				</Match>
			</Switch>
		</Panel>
	)
}
