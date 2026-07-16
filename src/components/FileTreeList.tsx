import type { BoxRenderable, MouseEvent } from "@opentui/core"
import { For, Show, createSignal } from "solid-js"
import { useFocus } from "../context/focus"
import { useTheme } from "../context/theme"
import type { Context } from "../context/types"
import { blendColors } from "../utils/color"
import { createDoubleClickDetector } from "../utils/double-click"
import type { FileLineStats, FlatFileNode } from "../utils/file-tree"
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
    fileLineStats?: () => ReadonlyMap<string, FileLineStats>
    selectedIndex: () => number
    setSelectedIndex: (index: number) => void
    collapsedPaths: () => Set<string>
    toggleFolder: (path: string) => void
    showTree?: () => boolean
    isFocused?: () => boolean
    focusContext?: Context
}

export function FileTreeList(props: FileTreeListProps) {
    const focus = useFocus()
    const { colors } = useTheme()
    const selectionBackground = () =>
        blendColors(colors().selectionBackground, colors().background, 0.5)
    const [hoveredPath, setHoveredPath] = createSignal<string | null>(null)

    return (
        <For each={props.files()}>
            {(item, index) => {
                const isSelected = () => index() === props.selectedIndex()
                const node = item.node
                const isTree = props.showTree?.() ?? true
                const indent = "  ".repeat(item.visualDepth)
                const isCollapsed = props.collapsedPaths().has(node.path)
                const isBinary = () => Boolean(node.isBinary)
                const lineStats = () => props.fileLineStats?.().get(node.path)
                const visibleLineStats = () =>
                    node.path === "" || hoveredPath() === node.path
                        ? lineStats()
                        : undefined

                const icon = node.isDirectory ? (isCollapsed ? "▶" : "▼") : " "
                const displayName = isTree ? node.name : node.path

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

                let rowRef: BoxRenderable | undefined

                const handleMouseDown = (e: {
                    stopPropagation: () => void
                }) => {
                    e.stopPropagation()
                    if (props.focusContext) {
                        focus.setActiveContext(props.focusContext)
                    }
                    props.setSelectedIndex(index())
                    handleDoubleClick()
                }

                const handleMouseOut = (event: MouseEvent) => {
                    if (
                        rowRef &&
                        event.x >= rowRef.screenX &&
                        event.x < rowRef.screenX + rowRef.width &&
                        event.y >= rowRef.screenY &&
                        event.y < rowRef.screenY + rowRef.height
                    ) {
                        return
                    }
                    setHoveredPath((path) => (path === node.path ? null : path))
                }

                const isListFocused = () => props.isFocused?.() ?? true
                const showSelection = () => isSelected()

                return (
                    // biome-ignore lint/a11y/useKeyWithMouseEvents: File-tree rows are keyboard navigable independently of hover stats.
                    <box
                        ref={(ref) => {
                            rowRef = ref
                        }}
                        backgroundColor={
                            showSelection()
                                ? isListFocused()
                                    ? colors().selectionBackground
                                    : selectionBackground()
                                : undefined
                        }
                        overflow="hidden"
                        onMouseDown={handleMouseDown}
                        onMouseOver={() => setHoveredPath(node.path)}
                        onMouseOut={handleMouseOut}
                        flexDirection="row"
                    >
                        <text
                            wrapMode="none"
                            width={0}
                            flexGrow={1}
                            flexShrink={1}
                            overflow="hidden"
                        >
                            <span style={{ fg: colors().textMuted }}>
                                {indent}
                            </span>
                            <Show when={isTree}>
                                <span
                                    style={{
                                        fg: node.isDirectory
                                            ? colors().info
                                            : colors().textMuted,
                                    }}
                                >
                                    {icon}{" "}
                                </span>
                            </Show>
                            <Show when={!node.isDirectory}>
                                <span style={{ fg: statusColor }}>
                                    {statusChar}{" "}
                                </span>
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
                                {displayName}
                            </span>
                            <Show when={isBinary()}>
                                <span style={{ fg: colors().textMuted }}>
                                    {" "}
                                    (binary)
                                </span>
                            </Show>
                        </text>
                        <Show when={visibleLineStats()}>
                            {(stats: () => FileLineStats) => (
                                <box flexShrink={0} paddingLeft={1}>
                                    <text wrapMode="none" flexShrink={0}>
                                        <Show when={stats().additions > 0}>
                                            <span
                                                style={{
                                                    fg: colors().diff
                                                        .additionText,
                                                }}
                                            >
                                                +{stats().additions}
                                            </span>
                                        </Show>
                                        <Show
                                            when={
                                                stats().additions > 0 &&
                                                stats().deletions > 0
                                            }
                                        >
                                            <span> </span>
                                        </Show>
                                        <Show when={stats().deletions > 0}>
                                            <span
                                                style={{
                                                    fg: colors().diff
                                                        .deletionText,
                                                }}
                                            >
                                                -{stats().deletions}
                                            </span>
                                        </Show>
                                    </text>
                                </box>
                            )}
                        </Show>
                    </box>
                )
            }}
        </For>
    )
}
