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
import { jjBookmarkCreate, jjBookmarkSet } from "../../commander/bookmarks"
import {
	type OpLogEntry,
	type OperationResult,
	fetchOpLog,
	isImmutableError,
	jjAbandon,
	jjDescribe,
	jjEdit,
	jjNew,
	jjNewBefore,
	jjOpRestore,
	jjRebase,
	jjRestore,
	jjShowDescription,
	jjSplitInteractive,
	jjSquash,
	jjSquashInteractive,
	parseOpLog,
} from "../../commander/operations"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useKeybind } from "../../context/keybind"
import { useLayout } from "../../context/layout"
import { useLoading } from "../../context/loading"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import type { Context } from "../../context/types"
import { createDoubleClickDetector } from "../../utils/double-click"
import { AnsiText } from "../AnsiText"
import { FilterInput } from "../FilterInput"
import { FilterableFileTree } from "../FilterableFileTree"
import { Panel } from "../Panel"
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
		refresh,
		flatFiles,
		selectedFileIndex,
		setSelectedFileIndex,
		filesLoading,
		filesError,
		collapsedPaths,
		toggleFolder,
		selectNextFile,
		selectPrevFile,
		bookmarks,
		revsetFilter,
		setRevsetFilter,
		revsetError,
		clearRevsetFilter,
		loadLog,
		loadMoreLog,
		logHasMore,
		logLimit,
		logLoadingMore,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const commandLog = useCommandLog()
	const dialog = useDialog()
	const globalLoading = useLoading()
	const keybind = useKeybind()
	const layout = useLayout()
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
		const width = Math.max(0, layout.terminalWidth() - 2)
		const trimmed = err.length > width ? err.slice(0, width) : err
		const padding = " ".repeat(Math.max(0, width - trimmed.length))
		return trimmed + padding
	}

	onCleanup(() => {
		command.setInputMode(false)
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
		if (query) {
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
			// Clear filter if query is empty and there was a filter
			clearRevsetFilter()
		}
		setFilterMode(false)
	}

	const isFocused = () => focus.isPanel("log")
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
		op: () => Promise<OperationResult>,
	) => {
		const result = await globalLoading.run(text, op)
		commandLog.addEntry(result)
		if (result.success) {
			refresh()
			loadOpLog()
		}
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
				if (commit) runOperation("Creating...", () => jjNew(commit.changeId))
			},
		},
		{
			id: "log.revisions.new_before",
			title: "new before",
			keybind: "jj_new_before",
			context: "log.revisions",
			type: "action",
			panel: "log",
			visibility: "help-only",
			onSelect: () => {
				const commit = selectedCommit()
				if (commit)
					runOperation("Creating...", () => jjNewBefore(commit.changeId))
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
							defaultTarget={parentCommit?.changeId}
							onSquash={async (target, options) => {
								if (options.interactive) {
									// Check if immutable first (before suspending TUI)
									let ignoreImmutable = false
									if (commit.immutable) {
										const confirmed = await dialog.confirm({
											message: "Commit is immutable. Squash anyway?",
										})
										if (!confirmed) return
										ignoreImmutable = true
									}

									// Interactive mode needs to suspend the TUI
									renderer.suspend?.()
									try {
										await jjSquashInteractive(commit.changeId, {
											into: target !== commit.changeId ? target : undefined,
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
									const result = await jjSquash(commit.changeId, {
										into: target,
										useDestinationMessage: options.useDestinationMessage,
										keepEmptied: options.keepEmptied,
									})
									if (isImmutableError(result)) {
										const confirmed = await dialog.confirm({
											message: "Target is immutable. Squash anyway?",
										})
										if (confirmed) {
											await runOperation("Squashing...", () =>
												jjSquash(commit.changeId, {
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
						hints: [
							{ key: "u", label: "use dest msg" },
							{ key: "K", label: "keep emptied" },
							{ key: "i", label: "interactive" },
							{ key: "enter", label: "squash" },
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
				dialog.open(
					() => (
						<RebaseModal
							source={commit}
							commits={commits()}
							defaultTarget={commit.changeId}
							onRebase={async (destination, options) => {
								const result = await jjRebase(commit.changeId, destination, {
									mode: options.mode,
									targetMode: options.targetMode,
									skipEmptied: options.skipEmptied,
								})
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
										loadOpLog()
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
			onSelect: () => {
				const commit = selectedCommit()
				if (!commit) return
				const localBookmarks = bookmarks().filter((b) => b.isLocal)
				dialog.open(
					() => (
						<SetBookmarkModal
							title={`Set bookmark on ${commit.changeId.slice(0, 8)}`}
							bookmarks={localBookmarks}
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
			enabled: () => !!revsetFilter(),
			onSelect: clearRevsetFilter,
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
			onSelect: selectNextFile,
		},
		{
			id: "log.files.prev",
			title: "up",
			keybind: "nav_up",
			context: "log.files",
			type: "navigation",
			panel: "log",
			visibility: "help-only",
			onSelect: selectPrevFile,
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
		{
			id: "log.files.restore",
			title: "restore",
			keybind: "jj_restore",
			context: "log.files",
			type: "action",
			panel: "log",
			onSelect: async () => {
				const file = flatFiles()[selectedFileIndex()]
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
							<box paddingLeft={1}>
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
								const showSelection = () => isSelected() && isFocused()
								return (
									<box onMouseDown={handleMouseDown}>
										<For each={commit.lines}>
											{(line) => (
												<box
													backgroundColor={
														showSelection()
															? colors().selectionBackground
															: undefined
													}
													overflow="hidden"
												>
													<AnsiText
														content={line}
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
						<text paddingLeft={1} fg={colors().error} wrapMode="none">
							{errorContent()}
						</text>
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
							<box paddingLeft={1} height={1}>
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
						const showSelection = () => isSelected() && isFocused()
						return (
							<For each={entry.lines}>
								{(line) => (
									<box
										backgroundColor={
											showSelection() ? colors().selectionBackground : undefined
										}
										overflow="hidden"
									>
										<AnsiText
											content={line}
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
						isFocused={isFocused}
						focusContext="log.files"
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
