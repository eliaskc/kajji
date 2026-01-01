import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createSignal } from "solid-js"
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
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { AnsiText } from "../AnsiText"
import { Panel } from "../Panel"
import { DescribeModal } from "../modals/DescribeModal"

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
	const { colors } = useTheme()

	const isFocused = () => focus.isPanel("log")
	const title = () => (viewMode() === "files" ? "Files" : "Log")

	const runOperation = async (op: () => Promise<OperationResult>) => {
		const result = await op()
		commandLog.addEntry(result)
		if (result.success) {
			loadLog()
			loadBookmarks()
		}
	}

	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)

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

	command.register(() => [
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
				if (commit) runOperation(() => jjNew(commit.changeId))
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
				if (commit) runOperation(() => jjEdit(commit.changeId))
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
						await runOperation(() =>
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
								runOperation(() =>
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
					await runOperation(() => jjAbandon(commit.changeId))
				}
			},
		},
	])

	return (
		<Panel title={title()} hotkey="1" focused={isFocused()}>
			<Show when={loading()}>
				<text>Loading...</text>
			</Show>
			<Show when={error()}>
				<text>Error: {error()}</text>
			</Show>
			<Show when={!loading() && !error()}>
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
		</Panel>
	)
}
