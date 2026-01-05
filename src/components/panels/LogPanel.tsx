import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
	For,
	Show,
	createEffect,
	createMemo,
	createSignal,
	on,
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
	jjOpRestore,
	jjRebase,
	jjRestore,
	jjShowDescription,
	jjSplitInteractive,
	jjSquash,
	parseOpLog,
} from "../../commander/operations"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useLoading } from "../../context/loading"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import type { Context } from "../../context/types"
import { createDoubleClickDetector } from "../../utils/double-click"
import { AnsiText } from "../AnsiText"
import { FileTreeList } from "../FileTreeList"
import { Panel } from "../Panel"
import { DescribeModal } from "../modals/DescribeModal"
import { RevisionPickerModal } from "../modals/RevisionPickerModal"
import { SetBookmarkModal } from "../modals/SetBookmarkModal"
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
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const commandLog = useCommandLog()
	const dialog = useDialog()
	const globalLoading = useLoading()
	const { colors } = useTheme()

	const [activeTab, setActiveTab] = createSignal<LogTab>("revisions")
	const [opLogEntries, setOpLogEntries] = createSignal<OpLogEntry[]>([])
	const [opLogLoading, setOpLogLoading] = createSignal(false)
	const [opLogSelectedIndex, setOpLogSelectedIndex] = createSignal(0)
	const [opLogLimit, setOpLogLimit] = createSignal(50)
	const [opLogHasMore, setOpLogHasMore] = createSignal(true)

	const isFocused = () => focus.isPanel("log")
	const isFilesView = () => viewMode() === "files"

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

	let opLogScrollRef: ScrollBoxRenderable | undefined
	const [opLogScrollTop, setOpLogScrollTop] = createSignal(0)

	createEffect(
		on([selectedIndex, commits], ([index, commitList]) => {
			if (!scrollRef || commitList.length === 0) return

			let lineOffset = 0
			const clampedIndex = Math.min(index, commitList.length)
			for (const commit of commitList.slice(0, clampedIndex)) {
				lineOffset += commit.lines.length
			}

			const margin = 2
			const refAny = scrollRef as unknown as Record<string, unknown>
			const viewportHeight =
				(typeof refAny.height === "number" ? refAny.height : null) ??
				(typeof refAny.rows === "number" ? refAny.rows : null) ??
				10
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
			const refAny = opLogScrollRef as unknown as Record<string, unknown>
			const viewportHeight =
				(typeof refAny.height === "number" ? refAny.height : null) ??
				(typeof refAny.rows === "number" ? refAny.rows : null) ??
				10
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

	let filesScrollRef: ScrollBoxRenderable | undefined
	const [filesScrollTop, setFilesScrollTop] = createSignal(0)

	createEffect(
		on([selectedFileIndex, flatFiles], ([index, files]) => {
			if (!filesScrollRef || files.length === 0) return

			const margin = 2
			const refAny = filesScrollRef as unknown as Record<string, unknown>
			const viewportHeight =
				(typeof refAny.height === "number" ? refAny.height : null) ??
				(typeof refAny.rows === "number" ? refAny.rows : null) ??
				10
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
			onSelect: selectNext,
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
			id: "log.revisions.edit",
			title: "edit",
			keybind: "jj_edit",
			context: "log.revisions",
			type: "action",
			panel: "log",
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
			onSelect: async () => {
				const commit = selectedCommit()
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
						loadOpLog()
					}
				}
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
										loadOpLog()
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
			id: "log.revisions.split",
			title: "split",
			keybind: "jj_split",
			context: "log.revisions",
			type: "action",
			panel: "log",
			onSelect: async () => {
				const commit = selectedCommit()
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
							{ key: "tab", label: "switch" },
							{ key: "enter", label: "confirm" },
						],
					},
				)
			},
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
		<>
			<Show when={loading() && commits().length === 0}>
				<text>Loading...</text>
			</Show>
			<Show when={error() && commits().length === 0}>
				<text>Error: {error()}</text>
			</Show>
			<Show when={commits().length > 0}>
				<scrollbox
					ref={scrollRef}
					flexGrow={1}
					scrollbarOptions={{ visible: false }}
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
												/>
											</box>
										)}
									</For>
								</box>
							)
						}}
					</For>
				</scrollbox>
			</Show>
		</>
	)

	const renderOpLogContent = () => (
		<>
			<Show when={opLogLoading() && opLogEntries().length === 0}>
				<text>Loading...</text>
			</Show>
			<Show when={opLogEntries().length > 0}>
				<scrollbox
					ref={opLogScrollRef}
					flexGrow={1}
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
												showSelection()
													? colors().selectionBackground
													: undefined
											}
											overflow="hidden"
										>
											<AnsiText content={line} wrapMode="none" />
										</box>
									)}
								</For>
							)
						}}
					</For>
				</scrollbox>
			</Show>
		</>
	)

	const renderFilesContent = () => {
		const commit = selectedCommit()
		return (
			<>
				<Show when={filesLoading()}>
					<text fg={colors().textMuted}>Loading files...</text>
				</Show>
				<Show when={filesError()}>
					<text fg={colors().error}>Error: {filesError()}</text>
				</Show>
				<Show when={!filesLoading() && !filesError()}>
					<scrollbox
						ref={filesScrollRef}
						flexGrow={1}
						scrollbarOptions={{ visible: false }}
					>
						<FileTreeList
							files={flatFiles}
							selectedIndex={selectedFileIndex}
							setSelectedIndex={setSelectedFileIndex}
							collapsedPaths={collapsedPaths}
							toggleFolder={toggleFolder}
							isFocused={isFocused}
						/>
					</scrollbox>
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
