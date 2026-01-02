import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createSignal } from "solid-js"
import { useCommand } from "../../context/command"
import { useFocus } from "../../context/focus"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { Panel } from "../Panel"

const STATUS_CHARS: Record<string, string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
	copied: "C",
}

export function FileTreePanel() {
	const {
		selectedCommit,
		flatFiles,
		selectedFileIndex,
		filesLoading,
		filesError,
		collapsedPaths,
		exitFilesView,
		toggleFolder,
		selectNextFile,
		selectPrevFile,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const { colors } = useTheme()

	const statusColors = () => ({
		added: colors().success,
		modified: colors().warning,
		deleted: colors().error,
		renamed: colors().info,
		copied: colors().info,
	})

	const isFocused = () => focus.isPanel("log")

	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)

	createEffect(() => {
		const index = selectedFileIndex()
		if (!scrollRef || flatFiles().length === 0) return

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
		if (index < safeStart) {
			newScrollTop = Math.max(0, index - margin)
		} else if (index > safeEnd) {
			newScrollTop = Math.max(0, index - viewportHeight + margin + 1)
		}

		if (newScrollTop !== currentScrollTop) {
			scrollRef.scrollTo(newScrollTop)
			setScrollTop(newScrollTop)
		}
	})

	const handleEnter = () => {
		const file = flatFiles()[selectedFileIndex()]
		if (file?.node.isDirectory) {
			toggleFolder(file.node.path)
		}
	}

	command.register(() => [
		{
			id: "log.revisions.files.next",
			title: "Next file",
			keybind: "nav_down",
			context: "log.revisions.files",
			type: "navigation",
			panel: "log",
			hidden: true,
			onSelect: selectNextFile,
		},
		{
			id: "log.revisions.files.prev",
			title: "Previous file",
			keybind: "nav_up",
			context: "log.revisions.files",
			type: "navigation",
			panel: "log",
			hidden: true,
			onSelect: selectPrevFile,
		},
		{
			id: "log.revisions.files.toggle",
			title: "Toggle folder",
			keybind: "enter",
			context: "log.revisions.files",
			type: "action",
			panel: "log",
			hidden: true,
			onSelect: handleEnter,
		},
		{
			id: "log.revisions.files.back",
			title: "Back to revisions",
			keybind: "escape",
			context: "log.revisions.files",
			type: "view",
			panel: "log",
			hidden: true,
			onSelect: exitFilesView,
		},
	])

	const commit = selectedCommit()
	const title = () =>
		commit ? `Files (${commit.changeId.slice(0, 8)})` : "Files"

	return (
		<Panel title={title()} hotkey="1" focused={isFocused()}>
			<Show when={filesLoading()}>
				<text fg={colors().textMuted}>Loading files...</text>
			</Show>
			<Show when={filesError()}>
				<text fg={colors().error}>Error: {filesError()}</text>
			</Show>
			<Show when={!filesLoading() && !filesError()}>
				<scrollbox
					ref={scrollRef}
					flexGrow={1}
					scrollbarOptions={{ visible: false }}
				>
					<For each={flatFiles()}>
						{(item, index) => {
							const isSelected = () => index() === selectedFileIndex()
							const node = item.node
							const indent = "  ".repeat(item.visualDepth)
							const isCollapsed = collapsedPaths().has(node.path)

							const icon = node.isDirectory ? (isCollapsed ? "▶" : "▼") : " "

							const statusChar = node.status
								? (STATUS_CHARS[node.status] ?? " ")
								: " "
							const statusColor = node.status
								? (statusColors()[
										node.status as keyof ReturnType<typeof statusColors>
									] ?? colors().text)
								: colors().text

							return (
								<box
									backgroundColor={
										isSelected() ? colors().selectionBackground : undefined
									}
									overflow="hidden"
								>
									<text>
										<span style={{ fg: colors().textMuted }}>{indent}</span>
										<span
											style={{
												fg: node.isDirectory
													? colors().info
													: colors().textMuted,
											}}
										>
											{icon}{" "}
										</span>
										<Show when={!node.isDirectory}>
											<span style={{ fg: statusColor }}>{statusChar} </span>
										</Show>
										<span
											style={{
												fg: node.isDirectory ? colors().info : colors().text,
											}}
										>
											{node.name}
										</span>
									</text>
								</box>
							)
						}}
					</For>
				</scrollbox>
			</Show>
		</Panel>
	)
}
