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
	type Bookmark,
	jjBookmarkCreate,
	jjBookmarkDelete,
	jjBookmarkForget,
	jjBookmarkRename,
	jjBookmarkSet,
} from "../../commander/bookmarks"
import { ghBrowseCommit, ghPrCreateWeb } from "../../commander/github"
import {
	type OperationResult,
	jjGitPushBookmark,
	jjIsInTrunk,
} from "../../commander/operations"
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
		remoteBookmarks,
		remoteBookmarksLoading,
		remoteBookmarksError,
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

	const openForBookmark = async (bookmark: Bookmark) => {
		if (!bookmark.changeId) {
			commandLog.addEntry({
				command: "open",
				success: false,
				exitCode: 1,
				stdout: "",
				stderr: "Bookmark has no target change",
			})
			return
		}

		try {
			if (await jjIsInTrunk(bookmark.commitId)) {
				const browseResult = await globalLoading.run("Opening...", () =>
					ghBrowseCommit(bookmark.commitId),
				)
				commandLog.addEntry(browseResult)
				return
			}
		} catch {
			// fall through to PR open
		}

		let needsPush = false
		if (!remoteBookmarksLoading() && !remoteBookmarksError()) {
			const remote = remoteBookmarks().find(
				(b) => !b.isLocal && b.name === bookmark.name,
			)
			needsPush = !remote?.changeId || remote.changeId !== bookmark.changeId
		}

		if (needsPush) {
			const confirmed = await dialog.confirm({
				message: `Bookmark "${bookmark.name}" isn't pushed. Push before opening PR?`,
			})
			if (!confirmed) return
			const pushResult = await globalLoading.run("Pushing...", () =>
				jjGitPushBookmark(bookmark.name),
			)
			commandLog.addEntry(pushResult)
			if (!pushResult.success) return
			await refresh()
		}

		const prResult = await globalLoading.run("Opening...", () =>
			ghPrCreateWeb(bookmark.name),
		)
		commandLog.addEntry(prResult)
	}

	const isFocused = () => focus.isPanel("refs")
	const localBookmarks = () => bookmarks().filter((b) => b.isLocal)
	const remoteBookmarkNames = createMemo(() => {
		const names = new Set<string>()
		for (const bookmark of remoteBookmarks()) {
			if (!bookmark.isLocal) {
				names.add(bookmark.name)
			}
		}
		return names
	})
	const canSplitByUntracked = createMemo(
		() => !remoteBookmarksLoading() && !remoteBookmarksError(),
	)

	const activeLocalBookmarks = createMemo(() =>
		visibleBookmarks().filter((b) => b.isLocal && b.changeId),
	)
	const deletedLocalBookmarks = createMemo(() =>
		visibleBookmarks().filter((b) => b.isLocal && !b.changeId),
	)
	const localOnlyBookmarks = createMemo(() =>
		activeLocalBookmarks().filter((b) => !remoteBookmarkNames().has(b.name)),
	)
	const trackedLocalBookmarks = createMemo(() =>
		activeLocalBookmarks().filter((b) => remoteBookmarkNames().has(b.name)),
	)
	const remoteOnlyBookmarks = createMemo(() => {
		const localNames = new Set(localBookmarks().map((b) => b.name))
		return remoteBookmarks().filter(
			(b) => !b.isLocal && !localNames.has(b.name),
		)
	})

	const visibleLocalBookmarks = createMemo(() => [
		...activeLocalBookmarks(),
		...deletedLocalBookmarks(),
	])

	const [filterMode, setFilterModeInternal] = createSignal(false)
	const [filterQuery, setFilterQuery] = createSignal("")
	const [appliedFilter, setAppliedFilter] = createSignal("")
	const [filterSelectedIndex, setFilterSelectedIndex] = createSignal(0)
	const [showRemoteOnly, setShowRemoteOnly] = createSignal(false)
	const [remoteSelectedIndex, setRemoteSelectedIndex] = createSignal(0)

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
		const source = showRemoteOnly()
			? remoteOnlyBookmarks()
			: visibleLocalBookmarks()
		if (!q) return source

		const results = fuzzysort.go(q, source, {
			key: "name",
			threshold: FUZZY_THRESHOLD,
			limit: 100,
		})
		return results.map((r) => r.obj)
	})

	const displayBookmarks = createMemo(() => {
		if (hasActiveFilter()) return filteredBookmarks()
		if (showRemoteOnly()) return remoteOnlyBookmarks()
		if (!canSplitByUntracked()) return visibleLocalBookmarks()
		return [
			...localOnlyBookmarks(),
			...trackedLocalBookmarks(),
			...deletedLocalBookmarks(),
		]
	})

	const currentBookmarks = () => displayBookmarks()

	const listTotalRows = createMemo(() => displayBookmarks().length)
	const canPageBookmarks = createMemo(
		() => !showRemoteOnly() && !hasActiveFilter() && bookmarksHasMore(),
	)

	const displaySelectedIndex = createMemo(() => {
		if (hasActiveFilter()) return filterSelectedIndex()
		if (showRemoteOnly()) return remoteSelectedIndex()
		const selected = selectedBookmark()
		if (!selected) return 0
		const idx = displayBookmarks().findIndex((b) => b.name === selected.name)
		return idx >= 0 ? idx : 0
	})

	const currentSelectedIndex = () => displaySelectedIndex()
	const localOnlySeparatorIndex = createMemo(() => localOnlyBookmarks().length)
	const showUntrackedSeparator = createMemo(
		() =>
			!hasActiveFilter() &&
			!showRemoteOnly() &&
			canSplitByUntracked() &&
			localOnlyBookmarks().length > 0 &&
			trackedLocalBookmarks().length + deletedLocalBookmarks().length > 0,
	)

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
				if (showRemoteOnly()) return
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
		const max = displayBookmarks().length - 1
		if (max < 0) return
		if (hasActiveFilter()) {
			setFilterSelectedIndex((i) => Math.min(max, i + 1))
			return
		}
		if (showRemoteOnly()) {
			setRemoteSelectedIndex((i) => Math.min(max, i + 1))
			return
		}
		const nextIndex = Math.min(max, displaySelectedIndex() + 1)
		const nextBookmark = displayBookmarks()[nextIndex]
		if (!nextBookmark) return
		const localIndex = localBookmarks().findIndex(
			(b) => b.name === nextBookmark.name,
		)
		if (localIndex >= 0) {
			setSelectedBookmarkIndex(localIndex)
		}
	}

	const selectPrevBookmarkInView = () => {
		if (hasActiveFilter()) {
			setFilterSelectedIndex((i) => Math.max(0, i - 1))
			return
		}
		if (showRemoteOnly()) {
			setRemoteSelectedIndex((i) => Math.max(0, i - 1))
			return
		}
		const prevIndex = Math.max(0, displaySelectedIndex() - 1)
		const prevBookmark = displayBookmarks()[prevIndex]
		if (!prevBookmark) return
		const localIndex = localBookmarks().findIndex(
			(b) => b.name === prevBookmark.name,
		)
		if (localIndex >= 0) {
			setSelectedBookmarkIndex(localIndex)
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

		if (!filterMode() && keybind.match("bookmark_toggle_remote", evt)) {
			evt.preventDefault()
			evt.stopPropagation()
			setShowRemoteOnly((prev) => !prev)
			setRemoteSelectedIndex(0)
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
						selectNextBookmarkInView()
					}
				}
			} else if (evt.name === "up") {
				evt.preventDefault()
				evt.stopPropagation()
				if (filterQuery().trim()) {
					setFilterSelectedIndex((i) => Math.max(0, i - 1))
				} else {
					selectPrevBookmarkInView()
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

	const title = () => (showRemoteOnly() ? "Bookmarks (Remote)" : "Bookmarks")
	const hasVisibleBookmarks = () =>
		showRemoteOnly()
			? remoteOnlyBookmarks().length > 0
			: localBookmarks().length > 0

	const handleListEnter = () => {
		if (showRemoteOnly()) return
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
			id: "refs.bookmarks.open",
			title: "open",
			keybind: "open",
			context: "refs.bookmarks",
			type: "action",
			panel: "refs",
			onSelect: () => {
				if (showRemoteOnly()) return
				const bookmark = selectedBookmark()
				if (!bookmark) return
				openForBookmark(bookmark)
			},
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
			id: "refs.bookmarks.toggle_remote",
			title: "toggle remote-only",
			keybind: "bookmark_toggle_remote",
			context: "refs.bookmarks",
			type: "view",
			panel: "refs",
			visibility: "help-only",
			onSelect: () => {
				setShowRemoteOnly((prev) => !prev)
				setRemoteSelectedIndex(0)
			},
		},
		{
			id: "refs.bookmarks.create",
			title: "create",
			keybind: "bookmark_create",
			context: "refs.bookmarks",
			type: "action",
			panel: "refs",
			onSelect: () => {
				if (showRemoteOnly()) return
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
				if (showRemoteOnly()) return
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
				if (showRemoteOnly()) return
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
				if (showRemoteOnly()) return
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
				if (showRemoteOnly()) return
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
				when={hasVisibleBookmarks()}
				fallback={
					!bookmarksLoading() && !bookmarksError() ? (
						<text fg={colors().textMuted}>
							{showRemoteOnly() ? "No remote-only bookmarks" : "No bookmarks"}
						</text>
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
										} else if (showRemoteOnly()) {
											setRemoteSelectedIndex(index())
										} else {
											const localIndex = localBookmarks().findIndex(
												(b) => b.name === bookmark.name,
											)
											if (localIndex >= 0) {
												setSelectedBookmarkIndex(localIndex)
											}
										}
										handleDoubleClick()
									}
									const isDeleted = () => !bookmark.changeId
									return (
										<>
											<Show
												when={
													showUntrackedSeparator() &&
													index() === localOnlySeparatorIndex()
												}
											>
												<box height={1} overflow="hidden">
													<text fg={colors().textMuted} wrapMode="none">
														{"─".repeat(200)}
													</text>
												</box>
											</Show>
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
														<Show when={showRemoteOnly() && bookmark.remote}>
															<text fg={colors().textMuted} wrapMode="none">
																@{bookmark.remote}
															</text>
															<text fg={colors().textMuted} wrapMode="none">
																{" "}
															</text>
														</Show>
													</box>
													<Show when={!isDeleted()}>
														<box flexGrow={1} overflow="hidden">
															<text
																fg={colors().textMuted}
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
										</>
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
