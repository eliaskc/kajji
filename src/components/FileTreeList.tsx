import { For, Show } from "solid-js"
import { useFocus } from "../context/focus"
import { useTheme } from "../context/theme"
import type { Context } from "../context/types"
import { createDoubleClickDetector } from "../utils/double-click"
import type { FlatFileNode } from "../utils/file-tree"
import { type FileStatus, getStatusColor } from "../utils/status-colors"

const STATUS_CHARS: Record<string, string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
	copied: "C",
}

export interface FileTreeListProps {
	files: () => FlatFileNode[]
	selectedIndex: () => number
	setSelectedIndex: (index: number) => void
	collapsedPaths: () => Set<string>
	toggleFolder: (path: string) => void
	isFocused?: () => boolean
	focusContext?: Context
}

export function FileTreeList(props: FileTreeListProps) {
	const focus = useFocus()
	const { colors } = useTheme()

	return (
		<For each={props.files()}>
			{(item, index) => {
				const isSelected = () => index() === props.selectedIndex()
				const node = item.node
				const indent = "  ".repeat(item.visualDepth)
				const isCollapsed = props.collapsedPaths().has(node.path)
				const isBinary = () => Boolean(node.isBinary)

				const icon = node.isDirectory ? (isCollapsed ? "▶" : "▼") : " "

				const statusChar = node.status
					? (STATUS_CHARS[node.status] ?? " ")
					: " "
				const statusColor = node.status
					? getStatusColor(node.status as FileStatus, colors())
					: colors().text

				const handleDoubleClick = createDoubleClickDetector(() => {
					if (node.isDirectory) {
						props.toggleFolder(node.path)
					} else {
						focus.setPanel("detail")
					}
				})

				const handleMouseDown = (e: { stopPropagation: () => void }) => {
					e.stopPropagation()
					if (props.focusContext) {
						focus.setActiveContext(props.focusContext)
					}
					if (isBinary()) return
					props.setSelectedIndex(index())
					handleDoubleClick()
				}

				const showSelection = () =>
					!isBinary() && isSelected() && (props.isFocused?.() ?? true)

				return (
					<box
						backgroundColor={
							showSelection() ? colors().selectionBackground : undefined
						}
						overflow="hidden"
						onMouseDown={handleMouseDown}
					>
						<text wrapMode="none">
							<span style={{ fg: colors().textMuted }}>{indent}</span>
							<span
								style={{
									fg: node.isDirectory ? colors().info : colors().textMuted,
								}}
							>
								{icon}{" "}
							</span>
							<Show when={!node.isDirectory}>
								<span style={{ fg: statusColor }}>{statusChar} </span>
							</Show>
							<span
								style={{
									fg: node.isDirectory
										? colors().info
										: isBinary()
											? colors().textMuted
											: colors().text,
								}}
							>
								{node.name}
							</span>
							<Show when={isBinary()}>
								<span style={{ fg: colors().textMuted }}> (binary)</span>
							</Show>
						</text>
					</box>
				)
			}}
		</For>
	)
}
