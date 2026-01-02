import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createSignal, onMount } from "solid-js"
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
	jjRedo,
	jjShowDescription,
	jjSquash,
	jjUndo,
	parseOpLog,
} from "../../commander/operations"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useLoading } from "../../context/loading"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { AnsiText } from "../AnsiText"
import { Panel } from "../Panel"
import { DescribeModal } from "../modals/DescribeModal"
import { UndoModal } from "../modals/UndoModal"

type LogTab = "log" | "oplog"

export function LogPanel() {
	const {
		commits,
		selectedIndex,
		selectedCommit,
		loading,
		error,
		selectNext,
		selectPrev,
		enterFilesView,
		viewMode,
		loadLog,
		loadBookmarks,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const commandLog = useCommandLog()
	const dialog = useDialog()
	const globalLoading = useLoading()
	const { colors } = useTheme()

	const [activeTab, setActiveTab] = createSignal<LogTab>("log")
	const [opLogEntries, setOpLogEntries] = createSignal<OpLogEntry[]>([])
	const [opLogLoading, setOpLogLoading] = createSignal(false)
	const [opLogSelectedIndex, setOpLogSelectedIndex] = createSignal(0)

	const isFocused = () => focus.isPanel("log")
	const isFilesView = () => viewMode() === "files"

	const tabs = () =>
		isFilesView()
			? undefined
			: [
					{ id: "log", label: "Log" },
					{ id: "oplog", label: "Oplog" },
				]

	const title = () => (isFilesView() ? "Files" : undefined)

	const loadOpLog = async () => {
		setOpLogLoading(true)
		try {
			const lines = await fetchOpLog()
			setOpLogEntries(parseOpLog(lines))
		} catch (e) {
			console.error("Failed to load op log:", e)
		} finally {
			setOpLogLoading(false)
		}
	}

	onMount(() => {
		loadOpLog()
	})

	const switchTab = (tab: LogTab) => {
		setActiveTab(tab)
		if (tab === "oplog") {
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
			loadLog()
			loadBookmarks()
			loadOpLog()
		}
	}

	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)

	let opLogScrollRef: ScrollBoxRenderable | undefined
	const [opLogScrollTop, setOpLogScrollTop] = createSignal(0)

	createEffect(() => {
		const index = selectedIndex()
		const commitList = commits()
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
	})

	createEffect(() => {
		const index = opLogSelectedIndex()
		const entries = opLogEntries()
		if (!opLogScrollRef || entries.length === 0) return

		let lineOffset = 0
		const clampedIndex = Math.min(index, entries.length)
		for (const entry of entries.slice(0, clampedIndex)) {
			lineOffset += entry.lines.length
		}

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
		} else if (lineOffset > safeEnd) {
			newScrollTop = Math.max(0, lineOffset - viewportHeight + margin + 1)
		}

		if (newScrollTop !== currentScrollTop) {
			opLogScrollRef.scrollTo(newScrollTop)
			setOpLogScrollTop(newScrollTop)
		}
	})

	const selectPrevOpLog = () => {
		setOpLogSelectedIndex((i) => Math.max(0, i - 1))
	}

	const selectNextOpLog = () => {
		setOpLogSelectedIndex((i) => Math.min(opLogEntries().length - 1, i + 1))
	}

	const selectedOperation = () => opLogEntries()[opLogSelectedIndex()]

	const openUndoModal = (type: "undo" | "redo") => {
		dialog.open(
			() => (
				<UndoModal
					type={type}
					onConfirm={async () => {
						dialog.close()
						const op = type === "undo" ? jjUndo : jjRedo
						await runOperation(
							type === "undo" ? "Undoing..." : "Redoing...",
							op,
						)
					}}
					onCancel={() => dialog.close()}
				/>
			),
			{ id: `${type}-modal` },
		)
	}

	command.register(() => [
		{
			id: "log.next_tab",
			title: "Next tab",
			keybind: "next_tab",
			context: "commits",
			type: "view",
			panel: "log",
			onSelect: () => switchTab("oplog"),
		},
		{
			id: "log.prev_tab",
			title: "Previous tab",
			keybind: "prev_tab",
			context: "commits",
			type: "view",
			panel: "log",
			onSelect: () => switchTab("oplog"),
		},
		{
			id: "oplog.next_tab",
			title: "Next tab",
			keybind: "next_tab",
			context: "oplog",
			type: "view",
			panel: "log",
			onSelect: () => switchTab("log"),
		},
		{
			id: "oplog.prev_tab",
			title: "Previous tab",
			keybind: "prev_tab",
			context: "oplog",
			type: "view",
			panel: "log",
			onSelect: () => switchTab("log"),
		},
		{
			id: "oplog.next",
			title: "Next operation",
			keybind: "nav_down",
			context: "oplog",
			type: "navigation",
			panel: "log",
			hidden: true,
			onSelect: selectNextOpLog,
		},
		{
			id: "oplog.prev",
			title: "Previous operation",
			keybind: "nav_up",
			context: "oplog",
			type: "navigation",
			panel: "log",
			hidden: true,
			onSelect: selectPrevOpLog,
		},
		{
			id: "commits.next",
			title: "Next commit",
			keybind: "nav_down",
			context: "commits",
			type: "navigation",
			panel: "log",
			hidden: true,
			onSelect: selectNext,
		},
		{
			id: "commits.prev",
			title: "Previous commit",
			keybind: "nav_up",
			context: "commits",
			type: "navigation",
			panel: "log",
			hidden: true,
			onSelect: selectPrev,
		},
		{
			id: "commits.view_files",
			title: "View files",
			keybind: "enter",
			context: "commits",
			type: "view",
			panel: "log",
			hidden: true,
			onSelect: () => enterFilesView(),
		},
		{
			id: "commits.new",
			title: "New change",
			keybind: "jj_new",
			context: "commits",
			type: "action",
			panel: "log",
			onSelect: () => {
				const commit = selectedCommit()
				if (commit) runOperation("Creating...", () => jjNew(commit.changeId))
			},
		},
		{
			id: "commits.edit",
			title: "Edit change",
			keybind: "jj_edit",
			context: "commits",
			type: "action",
			panel: "log",
			onSelect: () => {
				const commit = selectedCommit()
				if (commit) runOperation("Editing...", () => jjEdit(commit.changeId))
			},
		},
		{
			id: "commits.squash",
			title: "Squash into parent",
			keybind: "jj_squash",
			context: "commits",
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
						loadLog()
						loadBookmarks()
						loadOpLog()
					}
				}
			},
		},
		{
			id: "commits.describe",
			title: "Describe change",
			keybind: "jj_describe",
			context: "commits",
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
					{ id: "describe" },
				)
			},
		},
		{
			id: "commits.abandon",
			title: "Abandon change",
			keybind: "jj_abandon",
			context: "commits",
			type: "action",
			panel: "log",
			onSelect: async () => {
				const commit = selectedCommit()
				if (!commit) return
				const confirmed = await dialog.confirm({
					message: `Abandon change ${commit.changeId.slice(0, 8)}?`,
				})
				if (confirmed) {
					await runOperation("Abandoning...", () => jjAbandon(commit.changeId))
				}
			},
		},
		{
			id: "commits.undo",
			title: "Undo",
			keybind: "jj_undo",
			context: "commits",
			type: "action",
			panel: "log",
			onSelect: () => openUndoModal("undo"),
		},
		{
			id: "commits.redo",
			title: "Redo",
			keybind: "jj_redo",
			context: "commits",
			type: "action",
			panel: "log",
			onSelect: () => openUndoModal("redo"),
		},
		{
			id: "oplog.restore",
			title: "Restore to operation",
			keybind: "jj_restore",
			context: "oplog",
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
					{ id: "restore-modal" },
				)
			},
		},
	])

	createEffect(() => {
		if (isFocused() && !isFilesView()) {
			focus.setActiveContext(activeTab() === "oplog" ? "oplog" : "commits")
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
							return (
								<For each={commit.lines}>
									{(line) => (
										<box
											backgroundColor={
												isSelected() ? colors().selectionBackground : undefined
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
							return (
								<For each={entry.lines}>
									{(line) => (
										<box
											backgroundColor={
												isSelected() ? colors().selectionBackground : undefined
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

	return (
		<Panel
			title={title()}
			tabs={tabs()}
			activeTab={activeTab()}
			hotkey="1"
			focused={isFocused()}
		>
			<Show when={activeTab() === "log" || isFilesView()}>
				{renderLogContent()}
			</Show>
			<Show when={activeTab() === "oplog" && !isFilesView()}>
				{renderOpLogContent()}
			</Show>
		</Panel>
	)
}
