import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import { ptyToJson } from "ghostty-opentui"
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
import { withCommandObserver } from "../../commander/executor"
import { ghBrowseCommit, ghPrCreateWeb } from "../../commander/github"
import {
	type OperationResult,
	isImmutableError,
	jjEdit,
	jjGitPushBookmark,
	jjIsInTrunk,
	jjNew,
} from "../../commander/operations"
import { getRevisionId } from "../../commander/types"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { DIALOG_SIZE, useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useKeybind } from "../../context/keybind"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { resolveAnsiForeground } from "../../theme/ansi"
import { hasOriginDiff } from "../../utils/bookmark-origin-diff"
import { createDoubleClickDetector } from "../../utils/double-click"
import { FUZZY_THRESHOLD, scrollIntoView } from "../../utils/scroll"
import { AnsiText } from "../AnsiText"
import { FilterInput } from "../FilterInput"
import { Panel } from "../Panel"
import { BookmarkNameModal } from "../modals/BookmarkNameModal"
import { NoOriginDiffModal } from "../modals/NoOriginDiffModal"
import { RevisionPickerModal } from "../modals/RevisionPickerModal"

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

const emptyDescriptionPrefix = "(empty) "

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
		activeBookmarkDiff,
		enterBookmarkDiffView,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const keybind = useKeybind()
	const commandLog = useCommandLog()
	const dialog = useDialog()
	const { colors, mode } = useTheme()
	const { refresh } = useSync()

	const runOperation = async (
		text: string,
		op: (options?: {
			observer: ReturnType<typeof commandLog.observer>
		}) => Promise<OperationResult>,
	) => {
		const observer = commandLog.observer()
		const result = await withCommandObserver(observer, () => op({ observer }))
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
				const observer = commandLog.observer()
				const browseResult = await ghBrowseCommit(bookmark.commitId, {
					observer,
				})
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
				...DIALOG_SIZE.confirmWide,
				message: [
					"Bookmark ",
					{ text: bookmark.name, style: "target" },
					" isn't pushed. ",
					{ text: "Push", style: "action" },
					" before opening PR?",
				],
			})
			if (!confirmed) return
			const observer = commandLog.observer()
			const pushResult = await jjGitPushBookmark(bookmark.name, { observer })
			commandLog.addEntry(pushResult)
			if (!pushResult.success) return
			await refresh()
		}

		const observer = commandLog.observer()
		const prResult = await ghPrCreateWeb(bookmark.name, { observer })
		commandLog.addEntry(prResult)
	}

	const isFocused = () => focus.isPanel("refs")
	const localBookmarks = () => bookmarks().filter((b) => b.isLocal)
	const inlineAnsiSpans = (content: string, defaultFg?: string) => {
		const spans =
			ptyToJson(content, { cols: 9999, rows: 1 }).lines[0]?.spans ?? []
		return spans
			.filter((span) => span.text.length > 0)
			.map((span) => ({
				text: span.text,
				fg: resolveAnsiForeground({
					fg: span.fg,
					mode: mode(),
					text: colors().text,
					textMuted: colors().textMuted,
					defaultFg,
				}),
				bg: span.bg ?? undefined,
			}))
	}
	const bookmarkNameFg = (bookmark: Bookmark, defaultFg?: string) =>
		inlineAnsiSpans(bookmark.nameDisplay || bookmark.name, defaultFg).at(-1)?.fg ??
		(defaultFg ?? colors().text)
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
	const originChangedBookmarkNames = createMemo(() => {
		const originByName = new Map(
			remoteBookmarks()
				.filter((bookmark) => !bookmark.isLocal && bookmark.remote === "origin")
				.map((bookmark) => [bookmark.name, bookmark]),
		)
		const names = new Set<string>()
		for (const bookmark of activeLocalBookmarks()) {
			const origin = originByName.get(bookmark.name)
			if (origin?.commitId && origin.commitId !== bookmark.commitId) {
				names.add(bookmark.name)
			}
		}
		return names
	})
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
	const selectedBookmarkHasOriginDiff = createMemo(() => {
		if (showRemoteOnly()) return false
		const bookmark = selectedBookmark()
		return Boolean(bookmark && originChangedBookmarkNames().has(bookmark.name))
	})

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

	const openSelectedBookmarkOriginDiff = () => {
		if (showRemoteOnly()) return
		const bookmark = selectedBookmark()
		if (!bookmark || !hasOriginDiff(bookmark, remoteBookmarks())) {
			dialog.open(() => <NoOriginDiffModal />, {
				id: "bookmark-origin-diff-unavailable",
				title: [{ text: "No origin diff", style: "action" }],
				...DIALOG_SIZE.confirm,
				hints: [
					{ key: "enter", label: "close" },
					{ key: "esc", label: "close" },
				],
			})
			return
		}
		const activeDiff = activeBookmarkDiff()
		if (activeDiff?.bookmark === bookmark.name) return
		void enterBookmarkDiffView(bookmark.name)
	}

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
			id: "refs.bookmarks.new",
			title: "new",
			keybind: "jj_new",
			context: "refs.bookmarks",
			type: "action",
			panel: "refs",
			onSelect: () => {
				if (showRemoteOnly()) return
				const bookmark = selectedBookmark()
				if (!bookmark) return
				if (!bookmark.changeId) {
					commandLog.addEntry({
						command: `jj new ${bookmark.name}`,
						success: false,
						exitCode: 1,
						stdout: "",
						stderr: "Bookmark has no target change",
					})
					return
				}
				runOperation("Creating...", (options) => jjNew(bookmark.name, options))
			},
		},
		{
			id: "refs.bookmarks.edit",
			title: "edit",
			keybind: "jj_edit",
			context: "refs.bookmarks",
			type: "action",
			panel: "refs",
			onSelect: async () => {
				if (showRemoteOnly()) return
				const bookmark = selectedBookmark()
				if (!bookmark) return
				if (!bookmark.changeId) {
					commandLog.addEntry({
						command: `jj edit ${bookmark.name}`,
						success: false,
						exitCode: 1,
						stdout: "",
						stderr: "Bookmark has no target change",
					})
					return
				}
				const result = await jjEdit(bookmark.name)
				if (isImmutableError(result)) {
					const confirmed = await dialog.confirm({
						...DIALOG_SIZE.confirm,
						message: [
							{ text: bookmark.name, style: "target" },
							" is immutable. ",
							{ text: "Edit", style: "action" },
							" anyway?",
						],
					})
					if (confirmed) {
						await runOperation("Editing...", () =>
							jjEdit(bookmark.name, { ignoreImmutable: true }),
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
			title: "remote-only",
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
							commits={commits()}
							defaultRevision={
								workingCopy ? getRevisionId(workingCopy) : undefined
							}
							onSave={(name, revision) => {
								runOperation("Creating bookmark...", () =>
									jjBookmarkCreate(name, { revision }),
								)
							}}
						/>
					),
					{
						id: "bookmark-create",
						title: "Create Bookmark",
						...DIALOG_SIZE.form,
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
					...DIALOG_SIZE.confirm,
					message: [
						{ text: "Delete", style: "action" },
						" bookmark ",
						{ text: bookmark.name, style: "target" },
						"?",
					],
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
				if (showRemoteOnly()) return
				const bookmark = selectedBookmark()
				if (!bookmark) return
				dialog.open(
					() => (
						<BookmarkNameModal
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
						title: [
							{ text: "Rename", style: "action" },
							" ",
							{ text: bookmark.name, style: "target" },
						],
						...DIALOG_SIZE.form,
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
					...DIALOG_SIZE.confirm,
					message: [
						{ text: "Forget", style: "action" },
						" bookmark ",
						{ text: bookmark.name, style: "target" },
						"? ",
						{ text: "(local only)", style: "muted" },
					],
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
						title: [
							{ text: "Move", style: "action" },
							" ",
							{ text: bookmark.name, style: "target" },
							" to",
						],
						...DIALOG_SIZE.form,
						hints: [{ key: "enter", label: "confirm" }],
					},
				)
			},
		},
		{
			id: "refs.bookmarks.diff_origin",
			title: "compare to origin",
			keybind: "bookmark_diff_origin",
			context: "refs.bookmarks",
			type: "view",
			panel: "refs",
			visibility: selectedBookmarkHasOriginDiff() ? undefined : "help-only",
			onSelect: openSelectedBookmarkOriginDiff,
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
				<box
					flexDirection="column"
					flexGrow={1}
					backgroundColor={colors().background}
				>
					<Show when={currentBookmarks().length === 0 && hasActiveFilter()}>
						<box flexGrow={1}>
							<text fg={colors().textMuted}>No matching bookmarks</text>
						</box>
					</Show>

					<Show when={currentBookmarks().length > 0}>
						<scrollbox
							ref={listScrollRef}
							flexGrow={1}
							backgroundColor={colors().background}
							scrollbarOptions={{ visible: false }}
							contentOptions={{ backgroundColor: colors().background }}
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
												width="100%"
												height={1}
												flexShrink={0}
												backgroundColor={
													showSelection()
														? colors().selectionBackground
														: isActive()
															? colors().backgroundElement
															: colors().background
												}
												overflow="hidden"
												onMouseDown={handleMouseDown}
											>
												<box flexDirection="row" flexGrow={1} overflow="hidden">
													<box flexShrink={0} overflow="hidden">
														<text wrapMode="none">
															<Show
																when={!isDeleted()}
																fallback={
																	<span style={{ fg: colors().error }}>
																		{"–deleted "}
																	</span>
																}
															>
																<For
																	each={inlineAnsiSpans(
																		bookmark.changeIdDisplay ||
																			bookmark.changeId,
																		showSelection()
																			? colors().selectionText
																			: undefined,
																	)}
																>
																	{(span) => (
																		<span style={{ fg: span.fg, bg: span.bg }}>
																			{span.text}
																		</span>
																	)}
																</For>
																<span style={{ fg: colors().textMuted }}>
																	{" "}
																</span>
															</Show>
															<For
																each={inlineAnsiSpans(
																	bookmark.nameDisplay || bookmark.name,
																	showSelection()
																		? colors().selectionText
																		: undefined,
																)}
															>
																{(span) => (
																	<span style={{ fg: span.fg, bg: span.bg }}>
																		{span.text}
																	</span>
																)}
															</For>
															<Show
																when={
																	bookmark.isLocal &&
																	originChangedBookmarkNames().has(
																		bookmark.name,
																	)
																}
															>
																<span
																	style={{
																		fg: bookmarkNameFg(
																			bookmark,
																			showSelection()
																				? colors().selectionText
																				: undefined,
																		),
																	}}
																>
																	*
																</span>
															</Show>
															<Show when={!isDeleted()}>
																<span style={{ fg: colors().textMuted }}>
																	{" "}
																</span>
															</Show>
															<Show when={showRemoteOnly() && bookmark.remote}>
																<span style={{ fg: colors().textMuted }}>
																	@{bookmark.remote}{" "}
																</span>
															</Show>
														</text>
													</box>
													<Show when={!isDeleted()}>
														<box
															flexDirection="row"
															flexGrow={1}
															overflow="hidden"
														>
															<Show
																when={stripAnsi(
																	bookmark.descriptionDisplay,
																).startsWith(emptyDescriptionPrefix)}
																fallback={
																	<text
																		fg={colors().textMuted}
																		content={bookmark.description}
																		wrapMode="none"
																	/>
																}
															>
																<box
																	width={emptyDescriptionPrefix.length}
																	flexShrink={0}
																>
																	<text
																		fg={colors().success}
																		content={emptyDescriptionPrefix}
																		wrapMode="none"
																	/>
																</box>
																<box flexGrow={1} overflow="hidden">
																	<text
																		fg={colors().textMuted}
																		content={bookmark.description.slice(
																			emptyDescriptionPrefix.length,
																		)}
																		wrapMode="none"
																	/>
																</box>
															</Show>
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
									<box height={1}>
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
