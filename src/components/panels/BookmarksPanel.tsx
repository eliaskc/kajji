import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import {
	For,
	Show,
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
import type { OperationResult } from "../../commander/operations"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useDialog } from "../../context/dialog"
import { useDimmer } from "../../context/dimmer"
import { useFocus } from "../../context/focus"
import { useKeybind } from "../../context/keybind"
import { useLoading } from "../../context/loading"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { createDoubleClickDetector } from "../../utils/double-click"
import { FUZZY_THRESHOLD, scrollIntoView } from "../../utils/scroll"
import { AnsiText } from "../AnsiText"
import { FilterInput } from "../FilterInput"
import { Panel } from "../Panel"
import { BookmarkNameModal } from "../modals/BookmarkNameModal"
import { RevisionPickerModal } from "../modals/RevisionPickerModal"

export function BookmarksPanel() {
	const {
		commits,
		bookmarks,
		visibleBookmarks,
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
		revsetFilter,
		setRevsetFilter,
		activeBookmarkFilter,
		setActiveBookmarkFilter,
		setPreviousRevsetFilter,
		loadLog,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const keybind = useKeybind()
	const commandLog = useCommandLog()
	const dimmer = useDimmer()
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

	const activeLocalBookmarks = createMemo(() =>
		visibleBookmarks().filter((b) => b.isLocal && b.changeId),
	)
	const deletedLocalBookmarks = createMemo(() =>
		visibleBookmarks().filter((b) => b.isLocal && !b.changeId),
	)

	const visibleLocalBookmarks = createMemo(() => [
		...activeLocalBookmarks(),
		...deletedLocalBookmarks(),
	])

	const [filterMode, setFilterModeInternal] = createSignal(false)
	const [filterQuery, setFilterQuery] = createSignal("")
	const [appliedFilter, setAppliedFilter] = createSignal("")
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
		dimmer.clear("refs", "filter-bookmarks")
	})

	createEffect(() => {
		if (filterMode()) {
			dimmer.activate("refs", "filter-bookmarks")
		} else {
			dimmer.clear("refs", "filter-bookmarks")
		}
	})

	const activeFilterQuery = createMemo(() =>
		filterMode() ? filterQuery() : appliedFilter(),
	)
	const hasActiveFilter = createMemo(
		() => activeFilterQuery().trim().length > 0,
	)

	const filteredBookmarks = createMemo(() => {
		const q = activeFilterQuery().trim()
		if (!q) return visibleLocalBookmarks()

		const results = fuzzysort.go(q, visibleLocalBookmarks(), {
			key: "name",
			threshold: FUZZY_THRESHOLD,
			limit: 100,
		})
		return results.map((r) => r.obj)
	})

	const currentBookmarks = () =>
		hasActiveFilter() ? filteredBookmarks() : visibleLocalBookmarks()

	const listTotalRows = createMemo(() => currentBookmarks().length)
	const canPageBookmarks = createMemo(
		() => !hasActiveFilter() && bookmarksHasMore(),
	)

	const currentSelectedIndex = () =>
		hasActiveFilter() ? filterSelectedIndex() : selectedBookmarkIndex()

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

	createEffect(
		on(
			() =>
				[
					hasActiveFilter(),
					filteredBookmarks(),
					filterSelectedIndex(),
				] as const,
			([active, filtered, idx]) => {
				if (!active) return
				const selectedBookmarkItem = filtered[idx]
				if (!selectedBookmarkItem) return
				const originalIndex = localBookmarks().findIndex(
					(b) => b.name === selectedBookmarkItem.name,
				)
				if (originalIndex >= 0 && originalIndex !== selectedBookmarkIndex()) {
					setSelectedBookmarkIndex(originalIndex)
				}
			},
			{ defer: true },
		),
	)

	const selectNextBookmarkInView = () => {
		const max = currentBookmarks().length - 1
		if (max < 0) return
		if (hasActiveFilter()) {
			setFilterSelectedIndex((i) => Math.min(max, i + 1))
		} else {
			selectNextBookmark()
		}
	}

	const selectPrevBookmarkInView = () => {
		if (hasActiveFilter()) {
			setFilterSelectedIndex((i) => Math.max(0, i - 1))
		} else {
			selectPrevBookmark()
		}
	}

	const activateBookmarkFilter = () => {
		setFilterQuery(appliedFilter())
		setFilterMode(true)
		setFilterSelectedIndex(currentSelectedIndex())
		queueMicrotask(() => {
			filterInputRef?.requestRender?.()
			filterInputRef?.focus()
			filterInputRef?.gotoBufferEnd()
		})
	}

	const cancelBookmarkFilter = () => {
		setFilterMode(false)
		setFilterQuery("")
		filterInputRef?.clear()
	}

	const clearBookmarkFilter = () => {
		setAppliedFilter("")
		setFilterMode(false)
		setFilterQuery("")
		filterInputRef?.clear()
	}

	const applyBookmarkFilter = () => {
		const nextQuery = filterQuery().trim()
		if (nextQuery) {
			setAppliedFilter(nextQuery)
			setFilterSelectedIndex(0)
		} else if (appliedFilter()) {
			setAppliedFilter("")
		}
		setFilterMode(false)
		setFilterQuery("")
		filterInputRef?.clear()
	}

	useKeyboard((evt) => {
		if (!isFocused()) return

		if (!filterMode() && hasActiveFilter() && evt.name === "escape") {
			evt.preventDefault()
			evt.stopPropagation()
			clearBookmarkFilter()
			return
		}

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
				applyBookmarkFilter()
			}
		}
	})

	let listScrollRef: ScrollBoxRenderable | undefined

	const [listScrollTop, setListScrollTop] = createSignal(0)
	const [listViewportHeight, setListViewportHeight] = createSignal(30)
	const listThreshold = createMemo(() => {
		const buffer = Math.max(20, listViewportHeight() * 4)
		return Math.max(0, listTotalRows() - buffer)
	})

	createEffect(
		on(
			() => currentSelectedIndex(),
			(index) => {
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

	onMount(() => {
		const pollInterval = setInterval(() => {
			if (!listScrollRef) return
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

	const title = () => "Bookmarks"

	const handleListEnter = () => {
		const bookmark = selectedBookmark()
		if (!bookmark) return
		setPreviousRevsetFilter(revsetFilter())
		setActiveBookmarkFilter(bookmark.name)
		setRevsetFilter(`::${bookmark.name}`)
		loadLog()
		focus.setActiveContext("log.revisions")
	}

	command.register(() => [
		{
			id: "refs.bookmarks.next",
			title: "down",
			keybind: "nav_down",
			context: "refs.bookmarks",
			type: "navigation",
			panel: "refs",
			visibility: "help-only",
			onSelect: selectNextBookmarkInView,
		},
		{
			id: "refs.bookmarks.prev",
			title: "up",
			keybind: "nav_up",
			context: "refs.bookmarks",
			type: "navigation",
			panel: "refs",
			visibility: "help-only",
			onSelect: selectPrevBookmarkInView,
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
	])

	return (
		<Panel title={title()} hotkey="2" panelId="refs" focused={isFocused()}>
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
					<Show when={currentBookmarks().length === 0 && hasActiveFilter()}>
						<box paddingLeft={1} flexGrow={1}>
							<text fg={colors().textMuted}>No matching bookmarks</text>
						</box>
					</Show>

					<Show when={currentBookmarks().length > 0}>
						<scrollbox
							ref={listScrollRef}
							flexGrow={1}
							scrollbarOptions={{ visible: false }}
						>
							<For each={currentBookmarks()}>
								{(bookmark, index) => {
									const isSelected = () => index() === currentSelectedIndex()
									const showSelection = () => isSelected() && isFocused()
									const isActive = () =>
										activeBookmarkFilter() === bookmark.name
									const handleDoubleClick = createDoubleClickDetector(() => {
										handleListEnter()
									})
									const handleMouseDown = () => {
										if (hasActiveFilter()) {
											setFilterSelectedIndex(index())
										} else {
											setSelectedBookmarkIndex(index())
										}
										handleDoubleClick()
									}
									const isDeleted = () => !bookmark.changeId
									return (
										<box
											backgroundColor={
												showSelection()
													? colors().selectionBackground
													: isActive()
														? colors().backgroundElement
														: undefined
											}
											overflow="hidden"
											onMouseDown={handleMouseDown}
										>
											<box flexDirection="row" flexGrow={1} overflow="hidden">
												<box flexDirection="row" flexShrink={0}>
													<Show
														when={!isDeleted()}
														fallback={
															<text fg={colors().error} wrapMode="none">
																{"–deleted "}
															</text>
														}
													>
														<AnsiText
															content={
																bookmark.changeIdDisplay || bookmark.changeId
															}
															wrapMode="none"
														/>
														<text fg={colors().textMuted} wrapMode="none">
															{" "}
														</text>
													</Show>
													<AnsiText
														content={bookmark.nameDisplay || bookmark.name}
														wrapMode="none"
													/>
													<Show when={!isDeleted()}>
														<text fg={colors().textMuted} wrapMode="none">
															{" "}
														</text>
													</Show>
												</box>
												<Show when={!isDeleted()}>
													<box flexGrow={1} overflow="hidden">
														<AnsiText
															content={
																bookmark.descriptionDisplay ||
																bookmark.description
															}
															wrapMode="none"
														/>
													</box>
												</Show>
											</box>
										</box>
									)
								}}
							</For>
						</scrollbox>
					</Show>

					<Show when={hasActiveFilter() || filterMode()}>
						<Show
							when={filterMode()}
							fallback={
								<>
									<box height={1} overflow="hidden">
										<text fg={colors().textMuted} wrapMode="none">
											{"─".repeat(200)}
										</text>
									</box>
									<box paddingLeft={1} height={1}>
										<text fg={colors().textMuted}>/</text>
										<text fg={colors().text}>{appliedFilter()}</text>
									</box>
								</>
							}
						>
							<FilterInput
								ref={(r) => {
									filterInputRef = r
								}}
								onInput={setFilterQuery}
								dividerPosition="above"
								initialValue={appliedFilter()}
							/>
						</Show>
					</Show>
				</box>
			</Show>
		</Panel>
	)
}
