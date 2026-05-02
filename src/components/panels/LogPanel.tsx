import { resolve } from "node:path"
import type {
	MouseEvent,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
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
	fetchNearestAncestorBookmarkNames,
	isBookmarkBackwardsError,
	jjBookmarkCreate,
	jjBookmarkSet,
} from "../../commander/bookmarks"
import { withCommandObserver } from "../../commander/executor"
import { ghBrowseCommit, ghPrCreateWeb } from "../../commander/github"
import {
	type OpLogEntry,
	type OperationResult,
	fetchOpLog,
	isImmutableError,
	jjAbandon,
	jjDescribe,
	jjDuplicate,
	jjEdit,
	jjGitPushBookmark,
	jjGitPushChange,
	jjIsInTrunk,
	jjNew,
	jjNewAfter,
	jjNewBefore,
	jjOpRestore,
	jjRebase,
	jjResolveInteractive,
	jjRestore,
	jjShowDescription,
	jjSplitInteractive,
	jjSquash,
	jjSquashInteractive,
	parseOpLog,
} from "../../commander/operations"
import { type Commit, getRevisionId } from "../../commander/types"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { DIALOG_SIZE, useDialog } from "../../context/dialog"
import { useDimmer } from "../../context/dimmer"
import { useFocus } from "../../context/focus"
import { useKeybind } from "../../context/keybind"
import { useLoading } from "../../context/loading"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import type { Context } from "../../context/types"
import { getRepoPath } from "../../repo"
import { blendColors } from "../../utils/color"
import { createDoubleClickDetector } from "../../utils/double-click"
import { openInEditor, shouldSuspendForEditor } from "../../utils/editor"
import type { FileTreeNode } from "../../utils/file-tree"
import { AnsiText } from "../AnsiText"
import { FilterInput } from "../FilterInput"
import {
	FilterableFileTree,
	type FilterableFileTreeApi,
} from "../FilterableFileTree"
import { Panel } from "../Panel"
import { ActionMenuModal } from "../modals/ActionMenuModal"
import { BookmarkNameModal } from "../modals/BookmarkNameModal"
import { DescribeModal } from "../modals/DescribeModal"
import { RebaseModal } from "../modals/RebaseModal"
import { SetBookmarkModal } from "../modals/SetBookmarkModal"
import { SquashModal } from "../modals/SquashModal"
import { UndoModal } from "../modals/UndoModal"

type LogTab = "revisions" | "oplog"

const LOG_TABS: Array<{ id: LogTab; label: string; context: Context }> = [
	{ id: "revisions", label: "Revisions", context: "log.revisions" },
	{ id: "oplog", label: "Oplog", context: "log.oplog" },
]

function sortBookmarksByProximity(
	bookmarks: Bookmark[],
	orderedCommits: Array<{ changeId: string }>,
	targetChangeId: string,
	nearestHeadBookmarkNames: string[] = [],
): Bookmark[] {
	const nearestHeadRank = new Map(
		nearestHeadBookmarkNames.map((name, index) => [name, index]),
	)
	const toCanonicalChangeId = (changeId: string) => changeId.trim()
	const commitIndexByChangeId = new Map(
		orderedCommits.map((commit, index) => [
			toCanonicalChangeId(commit.changeId),
			index,
		]),
	)
	const targetIndex = commitIndexByChangeId.get(
		toCanonicalChangeId(targetChangeId),
	)
	if (targetIndex === undefined) return bookmarks

	return bookmarks
		.map((bookmark, originalIndex) => {
			const headRank = nearestHeadRank.get(bookmark.name)
			if (headRank !== undefined) {
				return {
					bookmark,
					originalIndex,
					group: -1,
					distance: headRank,
				}
			}
			const bookmarkIndices = bookmark.changeId
				.split(",")
				.map((id) => commitIndexByChangeId.get(toCanonicalChangeId(id)))
				.filter((index): index is number => index !== undefined)
			const bookmarkIndex = bookmarkIndices.length
				? Math.min(...bookmarkIndices)
				: undefined
			if (bookmarkIndex === undefined) {
				return {
					bookmark,
					originalIndex,
					group: 2,
					distance: Number.POSITIVE_INFINITY,
				}
			}
			const delta = bookmarkIndex - targetIndex
			return {
				bookmark,
				originalIndex,
				group: delta >= 0 ? 0 : 1,
				distance: Math.abs(delta),
			}
		})
		.sort(
			(a, b) =>
				a.group - b.group ||
				a.distance - b.distance ||
				a.originalIndex - b.originalIndex,
		)
		.map((entry) => entry.bookmark)
}

export function LogPanel() {
	const renderer = useRenderer()
	const {
		commits,
		selectedIndex,
		setSelectedIndex,
		selectedCommit,
		loading,
		error,
		selectNext,
		selectPrev,
		enterFilesView,
		exitFilesView,
		viewMode,
		fileTree,
		refresh,
		flatFiles,
		selectedFileIndex,
		setSelectedFileIndex,
		filesLoading,
		filesError,
		collapsedPaths,
		toggleFolder,
		showTree,
		toggleShowTree,
		selectNextFile,
		selectPrevFile,
		bookmarks,
		remoteBookmarks,
		remoteBookmarksLoading,
		remoteBookmarksError,
		revsetFilter,
		loadBookmarks,
		setRevsetFilter,
		revsetError,
		clearRevsetFilter,
		activeBookmarkFilter,
		previousRevsetFilter,
		clearBookmarkFilterState,
		loadLog,
		loadMoreLog,
		logHasMore,
		logLimit,
		logLoadingMore,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const commandLog = useCommandLog()
	const dimmer = useDimmer()
	const dialog = useDialog()
	const globalLoading = useLoading()
	const keybind = useKeybind()
	const { colors } = useTheme()

	const [activeTab, setActiveTab] = createSignal<LogTab>("revisions")
	const [opLogEntries, setOpLogEntries] = createSignal<OpLogEntry[]>([])
	const [opLogLoading, setOpLogLoading] = createSignal(false)
	const [opLogSelectedIndex, setOpLogSelectedIndex] = createSignal(0)
	const [opLogLimit, setOpLogLimit] = createSignal(50)
	const [opLogHasMore, setOpLogHasMore] = createSignal(true)

	// Revset filter mode state
	const [filterMode, setFilterModeInternal] = createSignal(false)
	const [filterQuery, setFilterQuery] = createSignal("")
	let filterInputRef: TextareaRenderable | undefined

	const setFilterMode = (value: boolean) => {
		setFilterModeInternal(value)
		command.setInputMode(value)
	}

	const errorContent = () => {
		const err = revsetError()
		if (err === null) return null
		const width = Math.max(0, logViewportWidth() - 2)
		const trimmed = err.length > width ? err.slice(0, width) : err
		const padding = " ".repeat(Math.max(0, width - trimmed.length))
		return trimmed + padding
	}

	onCleanup(() => {
		command.setInputMode(false)
		dimmer.clear("log", "filter-log")
	})

	createEffect(() => {
		if (filterMode()) {
			dimmer.activate("log", "filter-log")
		} else {
			dimmer.clear("log", "filter-log")
		}
	})

	const activateFilter = () => {
		// Pre-fill with existing filter
		setFilterQuery(revsetFilter() ?? "")
		setFilterMode(true)
		queueMicrotask(() => {
			filterInputRef?.focus()
			filterInputRef?.gotoBufferEnd()
		})
	}

	const cancelFilter = () => {
		setFilterMode(false)
		setFilterQuery("")
	}

	const applyFilter = async () => {
		const query = filterQuery().trim()
		const activeBookmarkRevset = activeBookmarkFilter()
			? `::${activeBookmarkFilter()}`
			: null
		const shouldClearBookmarkState =
			activeBookmarkRevset && query !== activeBookmarkRevset
		if (query) {
			if (shouldClearBookmarkState) {
				clearBookmarkFilterState()
			}
			setRevsetFilter(query)
			await loadLog()
			// Stay in filter mode if there was an error so user can fix it
			if (revsetError()) {
				queueMicrotask(() => {
					filterInputRef?.focus()
				})
				return
			}
		} else if (revsetFilter()) {
			if (activeBookmarkFilter()) {
				clearBookmarkFilterState()
			}
			// Clear filter if query is empty and there was a filter
			clearRevsetFilter()
		}
		setFilterMode(false)
	}

	const handleClearFilter = async () => {
		const activeBookmark = activeBookmarkFilter()
		if (!activeBookmark) {
			clearRevsetFilter()
			return
		}
		const previousFilter = previousRevsetFilter()
		clearBookmarkFilterState()
		if (previousFilter) {
			setRevsetFilter(previousFilter)
			await loadLog()
		} else {
			clearRevsetFilter()
		}
		focus.setActiveContext("refs.bookmarks")
	}

	const isFocused = () => focus.isPanel("log")
	const inactiveSelectionBackground = () =>
		blendColors(colors().selectionBackground, colors().background, 0.5)
	const isFilesView = () => viewMode() === "files"

	createEffect(() => {
		if (activeTab() !== "revisions" || isFilesView()) {
			if (filterMode()) {
				setFilterMode(false)
				setFilterQuery("")
			}
		}
	})

	// Keyboard handler for filter mode (input handling only)
	useKeyboard((evt) => {
		if (!isFocused() || activeTab() !== "revisions" || isFilesView()) return
		if (!filterMode()) return

		if (evt.name === "escape") {
			evt.preventDefault()
			evt.stopPropagation()
			cancelFilter()
		} else if (evt.name === "enter" || evt.name === "return") {
			evt.preventDefault()
			evt.stopPropagation()
			applyFilter()
		}
	})

	const tabs = () => (isFilesView() ? undefined : LOG_TABS)

	const title = () => (isFilesView() ? "Files" : undefined)

	const loadOpLog = async (limit?: number) => {
		const effectiveLimit = limit ?? opLogLimit()
		const isInitialLoad = opLogEntries().length === 0
		if (isInitialLoad) setOpLogLoading(true)
		try {
			await globalLoading.run("Loading...", async () => {
				const lines = await fetchOpLog(effectiveLimit)
				const entries = parseOpLog(lines)
				setOpLogEntries(entries)
				setOpLogHasMore(entries.length >= effectiveLimit)
			})
		} catch (e) {
			console.error("Failed to load op log:", e)
		} finally {
			if (isInitialLoad) setOpLogLoading(false)
		}
	}

	const loadMoreOpLog = async () => {
		if (!opLogHasMore() || opLogLoading()) return
		const newLimit = opLogLimit() + 50
		setOpLogLimit(newLimit)
		await loadOpLog(newLimit)
	}

	onMount(() => {
		loadOpLog()
	})

	const switchTab = (tabId: string) => {
		const tab = LOG_TABS.find((t) => t.id === tabId)
		if (!tab) return
		setActiveTab(tab.id)
		focus.setActiveContext(tab.context)
		if (tab.id === "oplog") {
			loadOpLog()
		}
	}

	const runOperation = async (
		text: string,
		op: (options?: {
			observer: ReturnType<typeof commandLog.observer>
		}) => Promise<OperationResult>,
	) => {
		const observer = commandLog.observer()
		const result = await globalLoading.run(text, () =>
			withCommandObserver(observer, () => op({ observer })),
		)
		commandLog.addEntry(result)
		if (result.success) {
			refresh()
			loadOpLog()
		}
		return result
	}

	const moveBookmark = async (
		bookmarkName: string,
		revision: string,
		options?: { allowBackwards?: boolean },
	): Promise<OperationResult> => {
		const result = await globalLoading.run("Moving bookmark...", () =>
			jjBookmarkSet(bookmarkName, revision, options),
		)
		commandLog.addEntry(result)
		if (result.success) {
			refresh()
			loadOpLog()
		}
		return result
	}

	const findLocalBookmark = (name: string) =>
		bookmarks().find((b) => b.isLocal && b.name === name)

	const bookmarkPointsToChange = (bookmark: Bookmark, changeId: string) =>
		bookmark.changeId
			.split(",")
			.map((id) => id.trim())
			.includes(changeId.trim())

	const findBookmarkForChange = (
		changeId: string,
		options?: { localOnly?: boolean },
	) =>
		bookmarks().find(
			(bookmark) =>
				(!options?.localOnly || bookmark.isLocal) &&
				bookmarkPointsToChange(bookmark, changeId),
		)

	const findBookmarkByName = (name: string) =>
		findLocalBookmark(name) ??
		bookmarks().find((bookmark) => bookmark.name === name)

	const createBookmarkPushAndOpen = async (
		commit: Commit,
		bookmarkName: string,
	) => {
		const createResult = await globalLoading.run("Creating bookmark...", () =>
			jjBookmarkCreate(bookmarkName, { revision: getRevisionId(commit) }),
		)
		commandLog.addEntry(createResult)
		if (!createResult.success) return

		const pushResult = await globalLoading.run("Pushing...", () =>
			jjGitPushBookmark(bookmarkName),
		)
		commandLog.addEntry(pushResult)
		if (!pushResult.success) return

		await refresh()
		await loadBookmarks()

		const prResult = await globalLoading.run("Opening...", () =>
			ghPrCreateWeb(bookmarkName),
		)
		commandLog.addEntry(prResult)
	}

	const promptForBookmarkAndOpen = (commit: Commit) => {
		dialog.open(
			() => (
				<BookmarkNameModal
					initialValue={`push-${commit.changeId.slice(0, 8)}`}
					onSave={(name) => {
						void createBookmarkPushAndOpen(commit, name)
					}}
				/>
			),
			{
				id: "open-pr-create-bookmark",
				title: "Create bookmark to open PR",
				...DIALOG_SIZE.form,
				hints: [{ key: "enter", label: "continue" }],
			},
		)
	}

	const openForBookmark = async (
		bookmark: Bookmark,
		options?: { confirmPush?: boolean },
	) => {
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
			if (options?.confirmPush !== false) {
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
			}
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

	const openForCommit = async (options?: { direct?: boolean }) => {
		const commit = selectedCommit()
		if (!commit) return

		try {
			if (await jjIsInTrunk(commit.commitId)) {
				const browseResult = await globalLoading.run("Opening...", () =>
					ghBrowseCommit(commit.commitId),
				)
				commandLog.addEntry(browseResult)
				return
			}
		} catch {
			// fall through to PR open
		}

		const bookmark = commit.bookmarks[0]
		let targetBookmark = bookmark ? findBookmarkByName(bookmark) : null
		if (!targetBookmark) {
			if (options?.direct) {
				const pushResult = await globalLoading.run("Pushing...", () =>
					jjGitPushChange(getRevisionId(commit)),
				)
				commandLog.addEntry(pushResult)
				if (!pushResult.success) return
				await refresh()
				await loadBookmarks()
				targetBookmark =
					findBookmarkForChange(commit.changeId, { localOnly: true }) ??
					findBookmarkForChange(commit.changeId)
				if (!targetBookmark) {
					commandLog.addEntry({
						command: "open",
						success: false,
						exitCode: 1,
						stdout: "",
						stderr:
							"Pushed the change, but couldn't resolve its bookmark yet. Try 'O' again.",
					})
					return
				}
			} else {
				promptForBookmarkAndOpen(commit)
				return
			}
		}

		await openForBookmark(targetBookmark, {
			confirmPush: options?.direct !== true,
		})
	}

	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)
	const [logViewportHeight, setLogViewportHeight] = createSignal(30)
	const [logViewportWidth, setLogViewportWidth] = createSignal(80)
	const [logScrollLeft, setLogScrollLeft] = createSignal(0)

	const logTotalLines = createMemo(() =>
		commits().reduce((sum, commit) => sum + commit.lines.length, 0),
	)

	let opLogScrollRef: ScrollBoxRenderable | undefined
	const [opLogScrollTop, setOpLogScrollTop] = createSignal(0)
	const [opLogViewportWidth, setOpLogViewportWidth] = createSignal(80)
	const [opLogScrollLeft, setOpLogScrollLeft] = createSignal(0)
	let filesFilterApi: FilterableFileTreeApi | undefined

	const stripAnsi = (str: string) => {
		let out = ""
		let i = 0
		while (i < str.length) {
			if (str[i] === "\u001b" && str[i + 1] === "[") {
				i += 2
				while (i < str.length && str[i] !== "m") i += 1
				if (i < str.length) i += 1
				continue
			}
			out += str[i]
			i += 1
		}
		return out
	}

	const logMaxLineLength = createMemo(() => {
		let maxLength = 0
		for (const commit of commits()) {
			for (const line of commit.lines) {
				const length = stripAnsi(line).length
				if (length > maxLength) maxLength = length
			}
		}
		return maxLength
	})

	const opLogMaxLineLength = createMemo(() => {
		let maxLength = 0
		for (const entry of opLogEntries()) {
			for (const line of entry.lines) {
				const length = stripAnsi(line).length
				if (length > maxLength) maxLength = length
			}
		}
		return maxLength
	})

	const clampScrollLeft = (value: number, maxLength: number, width: number) => {
		const contentWidth = Math.max(1, width)
		const maxScroll = Math.max(0, maxLength - contentWidth)
		return Math.max(0, Math.min(value, maxScroll))
	}

	const createHorizontalScrollHandler = (
		getScrollLeft: () => number,
		setScrollLeft: (value: number) => void,
		maxLength: () => number,
		viewportWidth: () => number,
	) => {
		return (event: MouseEvent) => {
			if (!event.scroll) return
			const delta = event.scroll.delta || 1
			const direction = event.scroll.direction
			const next =
				direction === "left"
					? getScrollLeft() - delta
					: direction === "right"
						? getScrollLeft() + delta
						: getScrollLeft()
			if (direction === "left" || direction === "right") {
				setScrollLeft(clampScrollLeft(next, maxLength(), viewportWidth()))
				event.preventDefault()
				event.stopPropagation()
			}
		}
	}

	createEffect(
		on([selectedIndex, commits], ([index, commitList]) => {
			if (!scrollRef || commitList.length === 0) return

			let lineOffset = 0
			const clampedIndex = Math.min(index, commitList.length)
			for (const commit of commitList.slice(0, clampedIndex)) {
				lineOffset += commit.lines.length
			}

			const margin = 2
			const viewportHeight = logViewportHeight()
			const currentScrollTop = scrollTop()

			const visibleStart = currentScrollTop
			const visibleEnd = currentScrollTop + viewportHeight - 1
			const safeStart = visibleStart + margin
			const safeEnd = visibleEnd - margin

			let newScrollTop = currentScrollTop
			if (lineOffset < safeStart) {
				newScrollTop = Math.max(0, lineOffset - margin)
			} else if (lineOffset > safeEnd) {
				newScrollTop = Math.max(0, lineOffset - viewportHeight + margin + 1)
			}

			if (newScrollTop !== currentScrollTop) {
				scrollRef.scrollTo(newScrollTop)
				setScrollTop(newScrollTop)
			}
		}),
	)

	createEffect(
		on([opLogSelectedIndex, opLogEntries], ([index, entries]) => {
			if (!opLogScrollRef || entries.length === 0) return

			let lineOffset = 0
			const clampedIndex = Math.min(index, entries.length)
			for (const entry of entries.slice(0, clampedIndex)) {
				lineOffset += entry.lines.length
			}
			const selectedHeight = entries[clampedIndex]?.lines.length ?? 1
			const lineEnd = lineOffset + selectedHeight - 1

			const margin = 2
			const viewportHeight = opLogScrollRef.viewport?.height ?? 30
			const currentScrollTop = opLogScrollTop()

			const visibleStart = currentScrollTop
			const visibleEnd = currentScrollTop + viewportHeight - 1
			const safeStart = visibleStart + margin
			const safeEnd = visibleEnd - margin

			let newScrollTop = currentScrollTop
			if (lineOffset < safeStart) {
				newScrollTop = Math.max(0, lineOffset - margin)
			} else if (lineEnd > safeEnd) {
				newScrollTop = Math.max(0, lineEnd - viewportHeight + margin + 1)
			}

			if (newScrollTop !== currentScrollTop) {
				opLogScrollRef.scrollTo(newScrollTop)
				setOpLogScrollTop(newScrollTop)
			}
		}),
	)

	onMount(() => {
		const pollInterval = setInterval(() => {
			if (!scrollRef) return
			const currentScroll = scrollRef.scrollTop ?? 0
			const currentViewport = scrollRef.viewport?.height ?? 30
			const currentViewportWidth = scrollRef.viewport?.width ?? 80
			if (currentScroll !== scrollTop()) {
				setScrollTop(currentScroll)
			}
			if (currentViewport !== logViewportHeight()) {
				setLogViewportHeight(currentViewport)
			}
			if (currentViewportWidth !== logViewportWidth()) {
				setLogViewportWidth(currentViewportWidth)
			}
			if (opLogScrollRef) {
				const opViewportWidth = opLogScrollRef.viewport?.width ?? 80
				if (opViewportWidth !== opLogViewportWidth()) {
					setOpLogViewportWidth(opViewportWidth)
				}
			}

			if (!logLoadingMore() && logHasMore()) {
				const buffer = Math.max(20, logViewportHeight() * 4)
				const threshold = Math.max(0, logTotalLines() - buffer)
				if (currentScroll + currentViewport >= threshold) {
					loadMoreLog()
				}
			}
		}, 100)
		onCleanup(() => clearInterval(pollInterval))
	})

	createEffect(() => {
		setLogScrollLeft(
			clampScrollLeft(logScrollLeft(), logMaxLineLength(), logViewportWidth()),
		)
	})

	createEffect(() => {
		setOpLogScrollLeft(
			clampScrollLeft(
				opLogScrollLeft(),
				opLogMaxLineLength(),
				opLogViewportWidth(),
			),
		)
	})

	let filesScrollRef: ScrollBoxRenderable | undefined
	const [filesScrollTop, setFilesScrollTop] = createSignal(0)

	createEffect(
		on([selectedFileIndex, flatFiles], ([index, files]) => {
			if (!filesScrollRef || files.length === 0) return

			const margin = 2
			const viewportHeight = filesScrollRef.viewport?.height ?? 30
			const currentScrollTop = filesScrollTop()

			const visibleStart = currentScrollTop
			const visibleEnd = currentScrollTop + viewportHeight - 1
			const safeStart = visibleStart + margin
			const safeEnd = visibleEnd - margin

			let newScrollTop = currentScrollTop
			if (index < safeStart) {
				newScrollTop = Math.max(0, index - margin)
			} else if (index > safeEnd) {
				newScrollTop = Math.max(0, index - viewportHeight + margin + 1)
			}

			if (newScrollTop !== currentScrollTop) {
				filesScrollRef.scrollTo(newScrollTop)
				setFilesScrollTop(newScrollTop)
			}
		}),
	)

	const handleFileEnter = () => {
		const file = flatFiles()[selectedFileIndex()]
		if (file?.node.isDirectory) {
			toggleFolder(file.node.path)
		}
	}

	const selectPrevOpLog = () => {
		setOpLogSelectedIndex((i) => Math.max(0, i - 1))
	}

	const selectNextOpLog = () => {
		const entries = opLogEntries()
		const currentIndex = opLogSelectedIndex()
		const newIndex = Math.min(entries.length - 1, currentIndex + 1)
		setOpLogSelectedIndex(newIndex)

		if (entries.length - newIndex <= 5 && opLogHasMore()) {
			loadMoreOpLog()
		}
	}

	const selectNextCommit = () => {
		if (logLoadingMore()) return
		selectNext()
		const list = commits()
		const index = selectedIndex()
		if (list.length - index <= 5 && logHasMore()) {
			loadMoreLog()
		}
	}

	const selectedOperation = () => opLogEntries()[opLogSelectedIndex()]

	const toAbsolutePath = (path: string) => resolve(getRepoPath(), path)

	const collectOpenablePaths = (node: FileTreeNode): string[] => {
		const paths: string[] = []
		const stack: FileTreeNode[] = [node]
		while (stack.length > 0) {
			const current = stack.pop()
			if (!current) continue
			if (!current.isDirectory && current.status !== "deleted") {
				paths.push(toAbsolutePath(current.path))
			}
			for (const child of current.children) {
				stack.push(child)
			}
		}
		return paths
	}

	const openPathsInEditor = async (paths: string[]) => {
		const uniquePaths = [...new Set(paths)]
		if (uniquePaths.length === 0) {
			commandLog.addEntry({
				command: "open editor",
				success: false,
				exitCode: 1,
				stdout: "",
				stderr: "No openable files in this commit",
			})
			return
		}

		const shouldSuspend = shouldSuspendForEditor()
		if (shouldSuspend) renderer.suspend?.()
		try {
			const result = await openInEditor(uniquePaths, { cwd: getRepoPath() })
			commandLog.addEntry({
				...result,
				stdout: "",
				stderr: result.success
					? ""
					: `Editor exited with code ${result.exitCode}`,
			})
		} finally {
			if (shouldSuspend) renderer.resume?.()
		}

		await refresh()
	}

	command.register(() => [
		{
			id: "log.oplog.prev",
			title: "up",
			keybind: "nav_up",
			context: "log.oplog",
			type: "navigation",
			panel: "log",
			visibility: "help-only",
			onSelect: selectPrevOpLog,
		},
		{
			id: "log.oplog.next",
			title: "down",
			keybind: "nav_down",
			context: "log.oplog",
			type: "navigation",
			panel: "log",
			visibility: "help-only",
			onSelect: selectNextOpLog,
		},
		{
			id: "log.revisions.next",
			title: "down",
			keybind: "nav_down",
			context: "log.revisions",
			type: "navigation",
			panel: "log",
			visibility: "help-only",
			onSelect: selectNextCommit,
		},
		{
			id: "log.revisions.prev",
			title: "up",
			keybind: "nav_up",
			context: "log.revisions",
			type: "navigation",
			panel: "log",
			visibility: "help-only",
			onSelect: selectPrev,
		},
		{
			id: "log.revisions.view_files",
			title: "view files",
			keybind: "enter",
			context: "log.revisions",
			type: "view",
			panel: "log",
			visibility: "help-only",
			onSelect: () => enterFilesView(),
		},
		{
			id: "log.revisions.new",
			title: "new",
			keybind: "jj_new",
			context: "log.revisions",
			type: "action",
			panel: "log",
			onSelect: () => {
				const commit = selectedCommit()
				if (commit)
					runOperation("Creating...", (options) =>
						jjNew(getRevisionId(commit), options),
					)
			},
		},
		{
			id: "log.revisions.new_menu",
			title: "new menu",
			keybind: "jj_new_options",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: () => {
				const commit = selectedCommit()
				if (!commit) return
				const revision = getRevisionId(commit)
				dialog.open(
					() => (
						<ActionMenuModal
							options={[
								{
									key: "n",
									mutedPrefix: "jj new",
									label: "",
									detail: "run hooks",
									onSelect: () =>
										runOperation("Creating...", (options) =>
											jjNew(revision, options),
										),
								},
								{
									key: "v",
									mutedPrefix: "jj new",
									label: " --no-verify",
									detail: "skip hooks",
									onSelect: () =>
										runOperation("Creating...", (options) =>
											jjNew(revision, { ...options, verify: false }),
										),
								},
								{
									key: "a",
									mutedPrefix: "jj new",
									label: " --after",
									onSelect: () =>
										runOperation("Creating...", (options) =>
											jjNewAfter(revision, options),
										),
								},
								{
									key: "b",
									mutedPrefix: "jj new",
									label: " --before",
									onSelect: () =>
										runOperation("Creating...", (options) =>
											jjNewBefore(revision, options),
										),
								},
							]}
						/>
					),
					{
						id: "new-menu",
						title: [
							{ text: "New", style: "action" },
							" options at ",
							{ text: commit.changeId.slice(0, 8), style: "target" },
						],
						...DIALOG_SIZE.confirm,
						hints: [{ key: "enter", label: "run" }],
					},
				)
			},
		},
		{
			id: "log.revisions.duplicate",
			title: "duplicate",
			keybind: "jj_duplicate",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: () => {
				const commit = selectedCommit()
				if (!commit) return
				runOperation("Duplicating...", () => jjDuplicate(getRevisionId(commit)))
			},
		},
		{
			id: "log.revisions.resolve",
			title: "resolve",
			keybind: "jj_resolve",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: async () => {
				const commit = selectedCommit()
				if (!commit) return
				renderer.suspend?.()
				const revId = getRevisionId(commit)
				const result = await jjResolveInteractive({
					revision: revId,
				})
				renderer.resume?.()
				commandLog.addEntry({
					command: `jj resolve -r ${revId}`,
					success: result.success,
					exitCode: result.success ? 0 : 1,
					stdout: "",
					stderr: result.error ?? "",
				})
				refresh()
				loadOpLog()
			},
		},
		{
			id: "log.revisions.edit",
			title: "edit",
			keybind: "jj_edit",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: async () => {
				const commit = selectedCommit()
				if (!commit) return
				const revId = getRevisionId(commit)
				const result = await jjEdit(revId)
				if (isImmutableError(result)) {
					const confirmed = await dialog.confirm({
						...DIALOG_SIZE.confirm,
						message: [
							{ text: commit.changeId.slice(0, 8), style: "target" },
							" is immutable. ",
							{ text: "Edit", style: "action" },
							" anyway?",
						],
					})
					if (confirmed) {
						await runOperation("Editing...", () =>
							jjEdit(revId, { ignoreImmutable: true }),
						)
					}
				} else {
					commandLog.addEntry(result)
					if (result.success) {
						refresh()
						loadOpLog()
					}
				}
			},
		},
		{
			id: "log.revisions.squash",
			title: "squash",
			keybind: "jj_squash",
			context: "log.revisions",
			type: "action",
			panel: "log",
			onSelect: () => {
				const commit = selectedCommit()
				if (!commit) return

				// Find parent (next commit in list is typically the parent)
				const commitList = commits()
				const revId = getRevisionId(commit)
				const currentIndex = commitList.findIndex(
					(c) => c.changeId === commit.changeId,
				)
				const parentCommit =
					currentIndex >= 0 && currentIndex < commitList.length - 1
						? commitList[currentIndex + 1]
						: undefined

				dialog.open(
					() => (
						<SquashModal
							source={commit}
							commits={commitList}
							defaultTarget={
								parentCommit ? getRevisionId(parentCommit) : undefined
							}
							onSquash={async (target, options) => {
								if (options.interactive) {
									// Check if immutable first (before suspending TUI)
									let ignoreImmutable = false
									if (commit.immutable) {
										const confirmed = await dialog.confirm({
											...DIALOG_SIZE.confirm,
											message: [
												{ text: commit.changeId.slice(0, 8), style: "target" },
												" is immutable. ",
												{ text: "Squash", style: "action" },
												" anyway?",
											],
										})
										if (!confirmed) return
										ignoreImmutable = true
									}

									// Interactive mode needs to suspend the TUI
									renderer.suspend?.()
									try {
										await jjSquashInteractive(revId, {
											into: target !== revId ? target : undefined,
											useDestinationMessage: options.useDestinationMessage,
											keepEmptied: options.keepEmptied,
											ignoreImmutable,
										})
									} finally {
										renderer.resume?.()
										refresh()
										loadOpLog()
									}
								} else {
									// Non-interactive squash
									const result = await jjSquash(revId, {
										into: target,
										useDestinationMessage: options.useDestinationMessage,
										keepEmptied: options.keepEmptied,
									})
									if (isImmutableError(result)) {
										const confirmed = await dialog.confirm({
											...DIALOG_SIZE.confirm,
											message: [
												"Target ",
												{ text: target.slice(0, 8), style: "target" },
												" is immutable. ",
												{ text: "Squash", style: "action" },
												" anyway?",
											],
										})
										if (confirmed) {
											await runOperation("Squashing...", () =>
												jjSquash(revId, {
													into: target,
													useDestinationMessage: options.useDestinationMessage,
													keepEmptied: options.keepEmptied,
													ignoreImmutable: true,
												}),
											)
										}
									} else {
										commandLog.addEntry(result)
										if (result.success) {
											refresh()
											loadOpLog()
										}
									}
								}
							}}
						/>
					),
					{
						id: "squash",
						title: [
							{ text: "Squash", style: "action" },
							" ",
							{ text: commit.changeId.slice(0, 8), style: "target" },
							" into",
						],
						...DIALOG_SIZE.picker,
						hints: [
							{ key: "u", label: "--use-destination-message" },
							{ key: "K", label: "--keep-emptied" },
							{ key: "i", label: "--interactive" },
							{ key: "enter", label: "run" },
						],
					},
				)
			},
		},
		{
			id: "log.revisions.rebase",
			title: "rebase",
			keybind: "jj_rebase",
			context: "log.revisions",
			type: "action",
			panel: "log",
			onSelect: () => {
				const commit = selectedCommit()
				if (!commit) return
				const revId = getRevisionId(commit)
				dialog.open(
					() => (
						<RebaseModal
							source={commit}
							commits={commits()}
							defaultTarget={revId}
							onRebase={async (destination, options) => {
								const result = await jjRebase(revId, destination, {
									mode: options.mode,
									targetMode: options.targetMode,
									skipEmptied: options.skipEmptied,
								})
								if (isImmutableError(result)) {
									const confirmed = await dialog.confirm({
										...DIALOG_SIZE.confirm,
										message: [
											"Source ",
											{ text: commit.changeId.slice(0, 8), style: "target" },
											" is immutable. ",
											{ text: "Rebase", style: "action" },
											" anyway?",
										],
									})
									if (confirmed) {
										await runOperation("Rebasing...", () =>
											jjRebase(revId, destination, {
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
										loadOpLog()
									}
								}
							}}
						/>
					),
					{
						id: "rebase",
						title: [
							{ text: "Rebase", style: "action" },
							" ",
							{ text: commit.changeId.slice(0, 8), style: "target" },
							" onto",
						],
						...DIALOG_SIZE.picker,
						hints: [
							{ key: "s", label: "--source" },
							{ key: "b", label: "--branch" },
							{ key: "e", label: "--skip-emptied" },
							{ key: "A", label: "--insert-after" },
							{ key: "B", label: "--insert-before" },
							{ key: "enter", label: "run" },
						],
					},
				)
			},
		},
		{
			id: "log.revisions.split",
			title: "split",
			keybind: "jj_split",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: async () => {
				const commit = selectedCommit()
				if (!commit) return

				if (commit.empty) {
					await dialog.confirm({
						...DIALOG_SIZE.confirm,
						message: [
							"Cannot ",
							{ text: "split", style: "action" },
							" an empty commit.",
						],
					})
					return
				}

				// Check if immutable first (before suspending TUI)
				let ignoreImmutable = false
				if (commit.immutable) {
					const confirmed = await dialog.confirm({
						...DIALOG_SIZE.confirm,
						message: [
							{ text: commit.changeId.slice(0, 8), style: "target" },
							" is immutable. ",
							{ text: "Split", style: "action" },
							" anyway?",
						],
					})
					if (!confirmed) return
					ignoreImmutable = true
				}

				renderer.suspend?.()
				try {
					await jjSplitInteractive(getRevisionId(commit), { ignoreImmutable })
				} finally {
					renderer.resume?.()
					refresh()
					loadOpLog()
				}
			},
		},
		{
			id: "log.revisions.describe",
			title: "describe",
			keybind: "jj_describe",
			context: "log.revisions",
			type: "action",
			panel: "log",
			onSelect: async () => {
				const commit = selectedCommit()
				if (!commit) return

				let ignoreImmutable = false
				if (commit.immutable) {
					const confirmed = await dialog.confirm({
						...DIALOG_SIZE.confirm,
						message: [
							{ text: commit.changeId.slice(0, 8), style: "target" },
							" is immutable. ",
							{ text: "Describe", style: "action" },
							" anyway?",
						],
					})
					if (!confirmed) return
					ignoreImmutable = true
				}

				const revId = getRevisionId(commit)
				const desc = await jjShowDescription(revId)
				dialog.open(
					() => (
						<DescribeModal
							initialSubject={desc.subject}
							initialBody={desc.body}
							onSave={(subject, body) => {
								const message = body ? `${subject}\n\n${body}` : subject
								runOperation("Describing...", () =>
									jjDescribe(revId, message, { ignoreImmutable }),
								)
							}}
						/>
					),
					{
						id: "describe",
						title: [
							{ text: "Describe", style: "action" },
							" ",
							{ text: commit.changeId.slice(0, 8), style: "target" },
						],
						...DIALOG_SIZE.describe,
						hints: [
							{ key: "tab", label: "switch field" },
							{ key: "enter", label: "save" },
						],
					},
				)
			},
		},
		{
			id: "log.revisions.open",
			title: "open",
			keybind: "open",
			context: "log.revisions",
			type: "action",
			panel: "log",
			onSelect: openForCommit,
		},
		{
			id: "log.revisions.open_direct",
			title: "open (direct)",
			keybind: "open_direct",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: () => {
				void openForCommit({ direct: true })
			},
		},
		{
			id: "log.revisions.abandon",
			title: "abandon",
			keybind: "jj_abandon",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: async () => {
				const commit = selectedCommit()
				if (!commit) return
				const confirmed = await dialog.confirm({
					...DIALOG_SIZE.confirm,
					message: [
						{ text: "Abandon", style: "action" },
						" change ",
						{ text: commit.changeId.slice(0, 8), style: "target" },
						"?",
					],
				})
				if (!confirmed) return
				const revId = getRevisionId(commit)
				const result = await jjAbandon(revId)
				if (isImmutableError(result)) {
					const immutableConfirmed = await dialog.confirm({
						...DIALOG_SIZE.confirm,
						message: [
							{ text: commit.changeId.slice(0, 8), style: "target" },
							" is immutable. ",
							{ text: "Abandon", style: "action" },
							" anyway?",
						],
					})
					if (immutableConfirmed) {
						await runOperation("Abandoning...", () =>
							jjAbandon(revId, { ignoreImmutable: true }),
						)
					}
				} else {
					commandLog.addEntry(result)
					if (result.success) {
						refresh()
						loadOpLog()
					}
				}
			},
		},
		{
			id: "log.revisions.set_bookmark",
			title: "set bookmark",
			keybind: "bookmark_set",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: async () => {
				const commit = selectedCommit()
				if (!commit) return
				const revId = getRevisionId(commit)
				const selectedChangeId = commit.changeId
				const localBookmarks = bookmarks().filter((b) => b.isLocal)
				const currentRevisionBookmarks = localBookmarks.filter((b) =>
					b.changeId
						.split(",")
						.map((id) => id.trim())
						.includes(selectedChangeId),
				)
				let nearestHeadBookmarkNames: string[] = []
				try {
					nearestHeadBookmarkNames =
						await fetchNearestAncestorBookmarkNames(revId)
				} catch {
					nearestHeadBookmarkNames = []
				}
				const moveTargetBookmarks = sortBookmarksByProximity(
					localBookmarks.filter(
						(b) =>
							!b.changeId
								.split(",")
								.map((id) => id.trim())
								.includes(selectedChangeId),
					),
					commits(),
					commit.changeId,
					nearestHeadBookmarkNames,
				)
				dialog.open(
					() => (
						<SetBookmarkModal
							bookmarks={moveTargetBookmarks}
							currentRevisionBookmarks={currentRevisionBookmarks}
							changeId={commit.changeId}
							onMove={async (bookmark, options) => {
								const result = await moveBookmark(bookmark.name, revId, options)
								if (!result.success && !isBookmarkBackwardsError(result)) {
									dialog.close()
								}
								return result
							}}
							onCreate={(name) => {
								runOperation("Creating bookmark...", () =>
									jjBookmarkCreate(name, { revision: revId }),
								)
							}}
						/>
					),
					{
						id: "set-bookmark",
						title: [
							{ text: "Set bookmark", style: "action" },
							" on ",
							{ text: commit.changeId.slice(0, 8), style: "target" },
						],
						...DIALOG_SIZE.form,
						hints: [{ key: "enter", label: "confirm" }],
					},
				)
			},
		},
		{
			id: "log.revisions.filter",
			title: "filter",
			keybind: "search",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: activateFilter,
		},
		{
			id: "log.revisions.clear_filter",
			title: "clear filter",
			keybind: "escape",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "none",
			onSelect: handleClearFilter,
		},
		{
			id: "log.oplog.restore",
			title: "restore",
			keybind: "jj_restore",
			context: "log.oplog",
			type: "action",
			panel: "log",
			onSelect: () => {
				const op = selectedOperation()
				if (!op) return
				dialog.open(
					() => (
						<UndoModal
							type="restore"
							operationLines={op.lines}
							onConfirm={async () => {
								dialog.close()
								await runOperation("Restoring...", () =>
									jjOpRestore(op.operationId),
								)
							}}
							onCancel={() => dialog.close()}
						/>
					),
					{
						id: "restore-modal",
						title: "Restore to this operation?",
						...DIALOG_SIZE.form,
						hints: [
							{ key: "y", label: "confirm" },
							{ key: "n", label: "cancel" },
						],
					},
				)
			},
		},
		{
			id: "log.files.next",
			title: "down",
			keybind: "nav_down",
			context: "log.files",
			type: "navigation",
			panel: "log",
			visibility: "help-only",
			onSelect: () => {
				if (filesFilterApi) {
					filesFilterApi.selectNext()
				} else {
					selectNextFile()
				}
			},
		},
		{
			id: "log.files.prev",
			title: "up",
			keybind: "nav_up",
			context: "log.files",
			type: "navigation",
			panel: "log",
			visibility: "help-only",
			onSelect: () => {
				if (filesFilterApi) {
					filesFilterApi.selectPrev()
				} else {
					selectPrevFile()
				}
			},
		},
		{
			id: "log.files.toggle",
			title: "toggle folder",
			keybind: "enter",
			context: "log.files",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: handleFileEnter,
		},
		{
			id: "log.files.back",
			title: "back",
			keybind: "escape",
			context: "log.files",
			type: "view",
			panel: "log",
			visibility: "help-only",
			onSelect: exitFilesView,
		},
		...(selectedCommit()?.isWorkingCopy
			? [
					{
						id: "log.files.restore",
						title: "discard",
						keybind: "jj_restore" as const,
						context: "log.files" as const,
						type: "action" as const,
						panel: "log" as const,
						onSelect: async () => {
							const fileIndex = selectedFileIndex()
							const file = flatFiles()[fileIndex]
							if (!file) return
							const node = file.node
							const displayPath = node.path || node.name
							const restorePaths = node.path ? [node.path] : []
							const confirmed = await dialog.confirm({
								...DIALOG_SIZE.confirmExtraWide,
								message: [
									{ text: "Discard", style: "action" },
									" changes to ",
									{ text: displayPath, style: "target" },
									"?",
								],
							})
							if (confirmed) {
								const result = await runOperation("Discarding...", () =>
									jjRestore(restorePaths),
								)
								if (result?.success) {
									const nextIndex = Math.min(fileIndex, flatFiles().length - 2)
									setSelectedFileIndex(Math.max(0, nextIndex))
								}
							}
						},
					},
				]
			: []),
		{
			id: "log.files.open_editor",
			title: "open in editor",
			keybind: "open_editor",
			context: "log.files",
			type: "action",
			panel: "log",
			onSelect: async () => {
				const file = flatFiles()[selectedFileIndex()]
				if (!file || file.node.isDirectory) {
					commandLog.addEntry({
						command: "open editor",
						success: false,
						exitCode: 1,
						stdout: "",
						stderr: "Select a file to open",
					})
					return
				}
				if (file.node.status === "deleted") {
					commandLog.addEntry({
						command: "open editor",
						success: false,
						exitCode: 1,
						stdout: "",
						stderr: `Cannot open deleted file: ${file.node.path}`,
					})
					return
				}
				await openPathsInEditor([toAbsolutePath(file.node.path)])
			},
		},
		{
			id: "log.files.open_editor_all",
			title: "open all in editor",
			keybind: "open_editor_all",
			context: "log.files",
			type: "action",
			panel: "log",
			onSelect: async () => {
				const tree = fileTree()
				if (!tree) {
					commandLog.addEntry({
						command: "open editor",
						success: false,
						exitCode: 1,
						stdout: "",
						stderr: "No files available",
					})
					return
				}
				await openPathsInEditor(collectOpenablePaths(tree))
			},
		},
		{
			id: "log.files.toggle_tree",
			title: "toggle file tree/list",
			keybind: "toggle_file_tree",
			context: "log.files",
			type: "view",
			panel: "log",
			onSelect: toggleShowTree,
		},
	])

	createEffect(() => {
		if (isFocused() && !isFilesView()) {
			const tab = LOG_TABS.find((t) => t.id === activeTab())
			if (tab) focus.setActiveContext(tab.context)
		}
	})

	const renderLogContent = () => (
		<box flexDirection="column" flexGrow={1}>
			<Show when={loading() && commits().length === 0}>
				<box />
			</Show>
			<Show when={error() && commits().length === 0}>
				<text>Error: {error()}</text>
			</Show>
			<Show when={commits().length > 0 || revsetFilter()}>
				<scrollbox
					ref={scrollRef}
					flexGrow={1}
					overflow="hidden"
					onMouseScroll={createHorizontalScrollHandler(
						logScrollLeft,
						setLogScrollLeft,
						logMaxLineLength,
						logViewportWidth,
					)}
					scrollbarOptions={{ visible: false }}
				>
					<Show
						when={commits().length > 0}
						fallback={
							<box>
								<text fg={colors().textMuted}>No matching revisions</text>
							</box>
						}
					>
						<For each={commits()}>
							{(commit, index) => {
								const isSelected = () => index() === selectedIndex()
								const handleClick = createDoubleClickDetector(() => {
									setSelectedIndex(index())
									enterFilesView()
								})
								const handleMouseDown = () => {
									setSelectedIndex(index())
									if (
										!logLoadingMore() &&
										commits().length - index() <= 5 &&
										logHasMore()
									) {
										loadMoreLog()
									}
									handleClick()
								}
								const showSelection = () => isSelected()
								const selectionBackground = () =>
									isFocused()
										? colors().selectionBackground
										: inactiveSelectionBackground()
								return (
									<box onMouseDown={handleMouseDown}>
										<For each={commit.lines}>
											{(line) => (
												<box
													backgroundColor={
														showSelection() ? selectionBackground() : undefined
													}
													overflow="hidden"
												>
													<AnsiText
														content={line}
														defaultFg={
															showSelection() && isFocused()
																? colors().selectionText
																: undefined
														}
														bold={commit.isWorkingCopy}
														wrapMode="none"
														onMouseScroll={createHorizontalScrollHandler(
															logScrollLeft,
															setLogScrollLeft,
															logMaxLineLength,
															logViewportWidth,
														)}
														cropStart={logScrollLeft()}
														cropWidth={Math.max(1, logViewportWidth())}
													/>
												</box>
											)}
										</For>
									</box>
								)
							}}
						</For>
					</Show>
				</scrollbox>
			</Show>

			{/* Revset filter display/input */}
			<Show when={revsetFilter() || filterMode()}>
				<box
					flexDirection="column"
					flexShrink={0}
					backgroundColor={colors().background}
				>
					{/* Error line */}
					<Show when={errorContent()}>
						<box height={1} overflow="hidden">
							<text fg={colors().error} wrapMode="none">
								{errorContent()}
							</text>
						</box>
					</Show>

					{/* Divider */}
					<box height={1} overflow="hidden">
						<text fg={colors().textMuted} wrapMode="none">
							{"─".repeat(200)}
						</text>
					</box>

					{/* Filter input or read-only display */}
					<Show
						when={filterMode()}
						fallback={
							<box height={1}>
								<text fg={colors().textMuted}>/</text>
								<text fg={colors().text}>{revsetFilter()}</text>
							</box>
						}
					>
						<FilterInput
							ref={(r) => {
								filterInputRef = r
							}}
							onInput={setFilterQuery}
							initialValue={revsetFilter() ?? ""}
							placeholder="Revset"
						/>
					</Show>
				</box>
			</Show>
		</box>
	)

	const renderOpLogContent = () => (
		<Show when={opLogEntries().length > 0}>
			<scrollbox
				ref={opLogScrollRef}
				flexGrow={1}
				overflow="hidden"
				onMouseScroll={createHorizontalScrollHandler(
					opLogScrollLeft,
					setOpLogScrollLeft,
					opLogMaxLineLength,
					opLogViewportWidth,
				)}
				scrollbarOptions={{ visible: false }}
			>
				<For each={opLogEntries()}>
					{(entry, index) => {
						const isSelected = () => index() === opLogSelectedIndex()
						const showSelection = () => isSelected()
						const selectionBackground = () =>
							isFocused()
								? colors().selectionBackground
								: inactiveSelectionBackground()
						return (
							<For each={entry.lines}>
								{(line) => (
									<box
										backgroundColor={
											showSelection() ? selectionBackground() : undefined
										}
										overflow="hidden"
									>
										<AnsiText
											content={line}
											defaultFg={
												showSelection() && isFocused()
													? colors().selectionText
													: undefined
											}
											wrapMode="none"
											onMouseScroll={createHorizontalScrollHandler(
												opLogScrollLeft,
												setOpLogScrollLeft,
												opLogMaxLineLength,
												opLogViewportWidth,
											)}
											cropStart={opLogScrollLeft()}
											cropWidth={Math.max(1, opLogViewportWidth())}
										/>
									</box>
								)}
							</For>
						)
					}}
				</For>
			</scrollbox>
		</Show>
	)

	const renderFilesContent = () => {
		return (
			<>
				<Show when={filesLoading()}>
					<text fg={colors().textMuted}>Loading files...</text>
				</Show>
				<Show when={filesError()}>
					<text fg={colors().error}>Error: {filesError()}</text>
				</Show>
				<Show when={!filesLoading() && !filesError()}>
					<FilterableFileTree
						files={flatFiles}
						selectedIndex={selectedFileIndex}
						setSelectedIndex={setSelectedFileIndex}
						collapsedPaths={collapsedPaths}
						toggleFolder={toggleFolder}
						showTree={showTree}
						isFocused={isFocused}
						focusContext="log.files"
						filterApiRef={(api) => {
							filesFilterApi = api
						}}
						scrollRef={(r) => {
							filesScrollRef = r
						}}
					/>
				</Show>
			</>
		)
	}

	const filesTitle = () => {
		const commit = selectedCommit()
		return commit ? `Files (${commit.changeId.slice(0, 8)})` : "Files"
	}

	return (
		<Panel
			title={isFilesView() ? filesTitle() : title()}
			tabs={tabs()}
			activeTab={activeTab()}
			onTabChange={switchTab}
			panelId="log"
			hotkey="1"
			focused={isFocused()}
		>
			<Show when={isFilesView()}>{renderFilesContent()}</Show>
			<Show when={!isFilesView() && activeTab() === "revisions"}>
				{renderLogContent()}
			</Show>
			<Show when={!isFilesView() && activeTab() === "oplog"}>
				{renderOpLogContent()}
			</Show>
		</Panel>
	)
}
