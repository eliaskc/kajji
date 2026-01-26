import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import {
	For,
	Match,
	Show,
	Switch,
	createEffect,
	createMemo,
	createSignal,
	on,
	onCleanup,
	onMount,
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
	jjNewBefore,
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
import { useKeybind } from "../../context/keybind"
import { useLoading } from "../../context/loading"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { createDoubleClickDetector } from "../../utils/double-click"
import { FUZZY_THRESHOLD, scrollIntoView } from "../../utils/scroll"
import { FilterInput } from "../FilterInput"
import { FilterableFileTree } from "../FilterableFileTree"
import { Panel } from "../Panel"
import { BookmarkNameModal } from "../modals/BookmarkNameModal"
import { DescribeModal } from "../modals/DescribeModal"
import { RebaseModal } from "../modals/RebaseModal"
import { RevisionPickerModal } from "../modals/RevisionPickerModal"
import { SetBookmarkModal } from "../modals/SetBookmarkModal"

export function BookmarksPanel() {
	const renderer = useRenderer()
	const {
		commits,
		bookmarks,
		visibleBookmarks,
		bookmarkLimit,
		loadMoreBookmarks,
		bookmarksHasMore,
		bookmarksLoadingMore,
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
		bookmarkCommitsHasMore,
		loadMoreBookmarkCommits,
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
	const keybind = useKeybind()
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
	const visibleLocalBookmarks = createMemo(() =>
		visibleBookmarks().filter((bookmark) => bookmark.isLocal),
	)

	const [filterMode, setFilterModeInternal] = createSignal(false)
	const [filterQuery, setFilterQuery] = createSignal("")
	const [filterSelectedIndex, setFilterSelectedIndex] = createSignal(0)

	let filterInputRef: TextareaRenderable | undefined

	const setFilterMode = (value: boolean) => {
		setFilterModeInternal(value)
		command.setInputMode(value)
	}

	onCleanup(() => {
		if (filterMode()) {
			command.setInputMode(false)
		}
	})

	const filteredBookmarks = createMemo(() => {
		const q = filterQuery().trim()
		if (!q) return visibleLocalBookmarks()

		const results = fuzzysort.go(q, visibleLocalBookmarks(), {
			key: "name",
			threshold: FUZZY_THRESHOLD,
			limit: 100,
		})
		return results.map((r) => r.obj)
	})

	const currentBookmarks = () =>
		filterMode() && filterQuery().trim()
			? filteredBookmarks()
			: visibleLocalBookmarks()

	const listTotalRows = createMemo(() => currentBookmarks().length)
	const canPageBookmarks = createMemo(() => !filterMode() && bookmarksHasMore())

	const currentSelectedIndex = () =>
		filterMode() && filterQuery().trim()
			? filterSelectedIndex()
			: selectedBookmarkIndex()

	createEffect(
		on(
			() => filterQuery(),
			() => {
				setFilterSelectedIndex(0)
			},
			{ defer: true },
		),
	)

	createEffect(
		on(
			() => [filteredBookmarks().length, filterSelectedIndex()] as const,
			([len, idx]) => {
				if (!filterMode()) return
				if (len > 0 && idx >= len) {
					setFilterSelectedIndex(len - 1)
				}
			},
			{ defer: true },
		),
	)

	// Sync filter selection back to parent
	createEffect(
		on(
			() => filterSelectedIndex(),
			(idx) => {
				if (!filterMode() || !filterQuery().trim()) return
				const filtered = filteredBookmarks()
				const selectedBookmarkItem = filtered[idx]
				if (selectedBookmarkItem) {
					const originalIndex = localBookmarks().findIndex(
						(b) => b.name === selectedBookmarkItem.name,
					)
					if (originalIndex >= 0 && originalIndex !== selectedBookmarkIndex()) {
						setSelectedBookmarkIndex(originalIndex)
					}
				}
			},
			{ defer: true },
		),
	)

	const activateBookmarkFilter = () => {
		setFilterMode(true)
		setFilterSelectedIndex(0)
		queueMicrotask(() => {
			filterInputRef?.requestRender?.()
			filterInputRef?.focus()
		})
	}

	const clearBookmarkFilter = () => {
		setFilterMode(false)
		setFilterQuery("")
		filterInputRef?.clear()
	}

	useKeyboard((evt) => {
		if (!isFocused()) return
		if (bookmarkViewMode() !== "list") return

		if (!filterMode() && keybind.match("search", evt)) {
			evt.preventDefault()
			evt.stopPropagation()
			activateBookmarkFilter()
			return
		}

		if (filterMode()) {
			if (evt.name === "escape") {
				evt.preventDefault()
				evt.stopPropagation()
				clearBookmarkFilter()
			} else if (evt.name === "down") {
				evt.preventDefault()
				evt.stopPropagation()
				const max = currentBookmarks().length - 1
				if (max >= 0) {
					if (filterQuery().trim()) {
						setFilterSelectedIndex((i) => Math.min(max, i + 1))
					} else {
						selectNextBookmark()
					}
				}
			} else if (evt.name === "up") {
				evt.preventDefault()
				evt.stopPropagation()
				if (filterQuery().trim()) {
					setFilterSelectedIndex((i) => Math.max(0, i - 1))
				} else {
					selectPrevBookmark()
				}
			} else if (evt.name === "enter" || evt.name === "return") {
				evt.preventDefault()
				evt.stopPropagation()
				handleListEnter()
			}
		}
	})

	let listScrollRef: ScrollBoxRenderable | undefined
	let commitsScrollRef: ScrollBoxRenderable | undefined
	let filesScrollRef: ScrollBoxRenderable | undefined

	const [listScrollTop, setListScrollTop] = createSignal(0)
	const [listViewportHeight, setListViewportHeight] = createSignal(30)
	const [commitsScrollTop, setCommitsScrollTop] = createSignal(0)
	const [filesScrollTop, setFilesScrollTop] = createSignal(0)

	const listThreshold = createMemo(() => {
		const buffer = Math.max(20, listViewportHeight() * 4)
		return Math.max(0, listTotalRows() - buffer)
	})

	createEffect(
		on(
			() => currentSelectedIndex(),
			(index) => {
				if (bookmarkViewMode() !== "list") return
				scrollIntoView({
					ref: listScrollRef,
					index,
					currentScrollTop: listScrollTop(),
					listLength: currentBookmarks().length,
					setScrollTop: setListScrollTop,
				})
			},
		),
	)

	onCleanup(() => {
		setListScrollTop(0)
		setListViewportHeight(30)
	})

	createEffect(
		on(selectedBookmarkCommitIndex, (index) => {
			scrollIntoView({
				ref: commitsScrollRef,
				index,
				currentScrollTop: commitsScrollTop(),
				listLength: bookmarkCommits().length,
				setScrollTop: setCommitsScrollTop,
			})
		}),
	)

	createEffect(
		on(selectedBookmarkFileIndex, (index) => {
			scrollIntoView({
				ref: filesScrollRef,
				index,
				currentScrollTop: filesScrollTop(),
				listLength: bookmarkFlatFiles().length,
				setScrollTop: setFilesScrollTop,
			})
		}),
	)

	onMount(() => {
		const pollInterval = setInterval(() => {
			if (bookmarkViewMode() !== "list" || !listScrollRef) return
			const currentScroll = listScrollRef.scrollTop ?? 0
			const currentViewport = listScrollRef.viewport?.height ?? 30
			if (currentScroll !== listScrollTop()) {
				setListScrollTop(currentScroll)
			}
			if (currentViewport !== listViewportHeight()) {
				setListViewportHeight(currentViewport)
			}

			if (!bookmarksLoadingMore() && canPageBookmarks()) {
				if (currentScroll + currentViewport >= listThreshold()) {
					loadMoreBookmarks()
				}
			}
		}, 100)
		onCleanup(() => clearInterval(pollInterval))
	})

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
		// Clear filter when leaving list view
		if (filterMode()) {
			clearBookmarkFilter()
		}
		enterBookmarkCommitsView()
	}

	const handleCommitsEnter = () => {
		enterBookmarkFilesView()
	}

	const selectNextBookmarkCommitWithLoad = () => {
		if (bookmarkCommitsLoading()) return
		selectNextBookmarkCommit()
		const list = bookmarkCommits()
		const index = selectedBookmarkCommitIndex()
		if (list.length - index <= 5 && bookmarkCommitsHasMore()) {
			loadMoreBookmarkCommits()
		}
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
					id: "refs.files.filter",
					title: "filter",
					keybind: "search",
					context: "refs.files",
					type: "view",
					panel: "refs",
					visibility: "help-only",
					onSelect: () => {
						// Handled by FilterableFileTree
					},
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
					onSelect: selectNextBookmarkCommitWithLoad,
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
					id: "refs.revisions.new_before",
					title: "new before",
					keybind: "jj_new_before",
					context: "refs.revisions",
					type: "action",
					panel: "refs",
					visibility: "help-only",
					onSelect: () => {
						const commit = selectedBookmarkCommit()
						if (commit)
							runOperation("Creating...", () => jjNewBefore(commit.changeId))
					},
				},
				{
					id: "refs.revisions.edit",
					title: "edit",
					keybind: "jj_edit",
					context: "refs.revisions",
					type: "action",
					panel: "refs",
					visibility: "help-only",
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
								<RebaseModal
									source={commit}
									commits={commits()}
									defaultTarget={commit.changeId}
									onRebase={async (destination, options) => {
										const result = await jjRebase(
											commit.changeId,
											destination,
											{
												mode: options.mode,
												targetMode: options.targetMode,
												skipEmptied: options.skipEmptied,
											},
										)
										if (isImmutableError(result)) {
											const confirmed = await dialog.confirm({
												message: "Target is immutable. Rebase anyway?",
											})
											if (confirmed) {
												await runOperation("Rebasing...", () =>
													jjRebase(commit.changeId, destination, {
														mode: options.mode,
														targetMode: options.targetMode,
														skipEmptied: options.skipEmptied,
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
								hints: [
									{ key: "s", label: "descendants" },
									{ key: "b", label: "branch" },
									{ key: "e", label: "skip emptied" },
									{ key: "a", label: "insert after" },
									{ key: "B", label: "insert before" },
									{ key: "enter", label: "rebase" },
								],
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
					visibility: "help-only",
					onSelect: async () => {
						const commit = selectedBookmarkCommit()
						if (!commit) return

						if (commit.empty) {
							await dialog.confirm({
								message: "Cannot split an empty commit.",
							})
							return
						}

						// Check if immutable first (before suspending TUI)
						let ignoreImmutable = false
						if (commit.immutable) {
							const confirmed = await dialog.confirm({
								message: "Commit is immutable. Split anyway?",
							})
							if (!confirmed) return
							ignoreImmutable = true
						}

						renderer.suspend?.()
						try {
							await jjSplitInteractive(commit.changeId, { ignoreImmutable })
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
					visibility: "help-only",
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
					visibility: "help-only",
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
									{ key: "up/down", label: "navigate" },
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
				id: "refs.bookmarks.filter",
				title: "filter",
				keybind: "search",
				context: "refs.bookmarks",
				type: "view",
				panel: "refs",
				visibility: "help-only",
				onSelect: activateBookmarkFilter,
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
				visibility: "help-only",
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
				visibility: "help-only",
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
				visibility: "help-only",
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
						<box flexDirection="column" flexGrow={1}>
							{/* Empty state - outside scrollbox */}
							<Show
								when={
									currentBookmarks().length === 0 &&
									filterMode() &&
									filterQuery().trim()
								}
							>
								<box paddingLeft={1} flexGrow={1}>
									<text fg={colors().textMuted}>No matching bookmarks</text>
								</box>
							</Show>

							{/* Bookmark list - only render scrollbox when we have bookmarks */}
							<Show when={currentBookmarks().length > 0}>
								<scrollbox
									ref={listScrollRef}
									flexGrow={1}
									scrollbarOptions={{ visible: false }}
								>
									<For each={currentBookmarks()}>
										{(bookmark, index) => {
											const isSelected = () =>
												index() === currentSelectedIndex()
											const showSelection = () => isSelected() && isFocused()
											const handleDoubleClick = createDoubleClickDetector(
												() => {
													enterBookmarkCommitsView()
												},
											)
											const handleMouseDown = () => {
												if (filterMode() && filterQuery().trim()) {
													setFilterSelectedIndex(index())
												} else {
													setSelectedBookmarkIndex(index())
												}
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

							{/* Filter input at bottom */}
							<Show when={filterMode()}>
								<FilterInput
									ref={(r) => {
										filterInputRef = r
									}}
									onInput={setFilterQuery}
									dividerPosition="above"
								/>
							</Show>
						</box>
					</Show>
				</Match>

				<Match when={bookmarkViewMode() === "commits"}>
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
											if (
												!bookmarkCommitsLoading() &&
												bookmarkCommitsHasMore() &&
												bookmarkCommits().length - index() <= 5
											) {
												loadMoreBookmarkCommits()
											}

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
					<Show when={!bookmarkFilesLoading()}>
						<FilterableFileTree
							files={bookmarkFlatFiles}
							selectedIndex={selectedBookmarkFileIndex}
							setSelectedIndex={setSelectedBookmarkFileIndex}
							collapsedPaths={bookmarkCollapsedPaths}
							toggleFolder={toggleBookmarkFolder}
							isFocused={isFocused}
							focusContext="refs.files"
							scrollRef={(r) => {
								filesScrollRef = r
							}}
						/>
					</Show>
				</Match>
			</Switch>
		</Panel>
	)
}
