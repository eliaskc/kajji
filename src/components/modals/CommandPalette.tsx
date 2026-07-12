import {
    type InputRenderable,
    RGBA,
    type ScrollBoxRenderable,
} from "@opentui/core"
import { useKeyboard } from "@opentui/solid"

const COMMAND_PALETTE_COLUMN_WIDTH = 32
const COMMAND_PALETTE_SCROLLBAR_GUTTER = 2

export function commandPaletteContentWidth(columns: number) {
    const colGap = columns === 3 ? 4 : 2
    return (
        columns * COMMAND_PALETTE_COLUMN_WIDTH +
        (columns - 1) * colGap +
        COMMAND_PALETTE_SCROLLBAR_GUTTER
    )
}

const SINGLE_LINE_KEYBINDINGS = [
    { name: "return", action: "submit" as const },
    { name: "enter", action: "submit" as const },
]
import fuzzysort from "fuzzysort"
import {
    type Accessor,
    For,
    Show,
    createEffect,
    createMemo,
    createSignal,
} from "solid-js"
import { type CommandGroup, commandGroup } from "../../command/policy"
import {
    type CommandOption,
    type Context,
    useCommand,
    useCommandInputGuard,
} from "../../context/command"
import { useDialog } from "../../context/dialog"
import { useLayout } from "../../context/layout"
import { useTheme } from "../../context/theme"
import type { KeybindConfigKey } from "../../keybind"

interface ContextGroupData {
    context: CommandGroup
    label: string
    commands: CommandOption[]
}

const GROUP_ORDER: CommandGroup[] = [
    "revisions",
    "files",
    "bookmarks",
    "oplog",
    "detail",
    "navigation",
    "repository",
    "application",
]

const GROUP_LABELS: Record<CommandGroup, string> = {
    navigation: "navigation",
    revisions: "revisions",
    files: "files",
    bookmarks: "bookmarks",
    oplog: "oplog",
    detail: "detail",
    repository: "repository",
    application: "application",
}

export function CommandPalette() {
    const command = useCommand()
    useCommandInputGuard()
    const dialog = useDialog()
    const layout = useLayout()
    const { colors, style } = useTheme()
    const [filter, setFilter] = createSignal("")
    const [selectedIndex, setSelectedIndex] = createSignal(-1)
    const [scrollTop, setScrollTop] = createSignal(0)
    let searchInputRef: InputRenderable | undefined
    let scrollRef: ScrollBoxRenderable | undefined

    const columnCount = () => layout.commandPaletteColumns()

    type SearchableCommand = CommandOption & { keybindStr: string }

    const allCommands = createMemo((): SearchableCommand[] => {
        return command.forSurface("palette").map((cmd) => ({
            ...cmd,
            keybindStr: command.keyLabel(cmd.id),
        }))
    })

    const matchedCommands = createMemo(() => {
        const all = allCommands()
        const filterText = filter().trim()

        if (!filterText) {
            return all
        }

        const results = fuzzysort.go(filterText, all, {
            keys: ["title", "description", "context", "keybindStr"],
            threshold: -10000,
        })

        return results.map((r) => r.obj)
    })

    const matchedIds = createMemo(() => {
        return new Set(matchedCommands().map((cmd) => cmd.id))
    })

    const isActive = (cmd: CommandOption) => command.isActive(cmd.id)

    createEffect(() => {
        const filterText = filter().trim()
        if (filterText) {
            setSelectedIndex(0)
        } else {
            setSelectedIndex(-1)
        }
    })

    const selectedCommand = createMemo(() => {
        const idx = selectedIndex()
        if (idx < 0) return null
        return matchedInColumnOrder()[idx] ?? null
    })

    const groupedCommands = createMemo((): ContextGroupData[] => {
        const all = allCommands()
        const groups = new Map<CommandGroup, CommandOption[]>()

        for (const cmd of all) {
            const group = commandGroup(cmd)
            const existing = groups.get(group) || []
            groups.set(group, [...existing, cmd])
        }

        const result: ContextGroupData[] = []
        for (const group of GROUP_ORDER) {
            const commands = groups.get(group)
            if (commands && commands.length > 0) {
                result.push({
                    context: group,
                    label: GROUP_LABELS[group],
                    commands,
                })
            }
        }

        return result
    })

    const columns = createMemo(() => {
        const groups = groupedCommands()
        const numCols = columnCount()
        const cols: ContextGroupData[][] = Array.from(
            { length: numCols },
            () => [],
        )

        let colIndex = 0
        for (const group of groups) {
            const col = cols[colIndex]
            if (col) col.push(group)
            colIndex = (colIndex + 1) % numCols
        }

        return cols
    })

    const filteredGroups = createMemo((): ContextGroupData[] => {
        const matched = matchedIds()
        return groupedCommands()
            .map((group) => ({
                ...group,
                commands: group.commands.filter((cmd) => matched.has(cmd.id)),
            }))
            .filter((group) => group.commands.length > 0)
    })

    const filteredColumns = createMemo(() => {
        const groups = filteredGroups()
        const numCols = columnCount()
        const cols: ContextGroupData[][] = Array.from(
            { length: numCols },
            () => [],
        )

        let colIndex = 0
        for (const group of groups) {
            const col = cols[colIndex]
            if (col) col.push(group)
            colIndex = (colIndex + 1) % numCols
        }

        return cols
    })

    const commandsInColumnOrder = createMemo(() => {
        const cols = columns()
        const result: CommandOption[] = []
        for (const column of cols) {
            for (const group of column) {
                for (const cmd of group.commands) {
                    result.push(cmd)
                }
            }
        }
        return result
    })

    const matchedInColumnOrder = createMemo(() => {
        const matched = matchedIds()
        return commandsInColumnOrder().filter(
            (cmd) => matched.has(cmd.id) && isActive(cmd),
        )
    })

    const isNavigatable = (cmd: CommandOption) => {
        return matchedIds().has(cmd.id) && isActive(cmd)
    }

    const getRowPositionForCommand = (cmd: CommandOption): number => {
        const cols = filteredColumns()
        let row = 0
        for (const column of cols) {
            let colRow = 0
            for (const group of column) {
                colRow += 1
                for (const c of group.commands) {
                    if (c.id === cmd.id) {
                        return row + colRow
                    }
                    colRow += 1
                }
                colRow += 1
            }
            if (columnCount() === 1) {
                row = colRow
            }
        }
        return 0
    }

    const scrollIntoView = (cmd: CommandOption | null) => {
        if (!scrollRef || !cmd) return
        if (columnCount() !== 1) return

        const rowPos = getRowPositionForCommand(cmd)
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
        if (rowPos < safeStart) {
            newScrollTop = Math.max(0, rowPos - margin)
        } else if (rowPos > safeEnd) {
            newScrollTop = Math.max(0, rowPos - viewportHeight + margin + 1)
        }

        if (newScrollTop !== currentScrollTop) {
            scrollRef.scrollTo(newScrollTop)
            setScrollTop(newScrollTop)
        }
    }

    const move = (direction: 1 | -1) => {
        const matched = matchedInColumnOrder()
        if (matched.length === 0) return

        setSelectedIndex((prev) => {
            if (prev < 0) return 0
            let next = prev + direction
            if (next < 0) next = matched.length - 1
            if (next >= matched.length) next = 0
            return next
        })
    }

    createEffect(() => {
        const cmd = selectedCommand()
        if (cmd) {
            scrollIntoView(cmd)
        }
    })

    const executeSelected = () => {
        const cmd = selectedCommand()
        if (cmd) {
            dialog.close()
            command.execute(cmd.id)
        }
    }

    useKeyboard((evt) => {
        if (evt.name === "down") {
            evt.preventDefault()
            evt.stopPropagation()
            move(1)
        } else if (evt.name === "up") {
            evt.preventDefault()
            evt.stopPropagation()
            move(-1)
        } else if (evt.name === "return") {
            evt.preventDefault()
            evt.stopPropagation()
            executeSelected()
        }
    })

    const separator = () => style().statusBar.separator
    const gap = () => (separator() ? 0 : 3)

    const isMatched = (cmd: CommandOption) => matchedIds().has(cmd.id)
    const isSelected = (cmd: CommandOption) => selectedCommand()?.id === cmd.id
    const columnGap = () => (columnCount() === 3 ? 4 : 2)
    const modalWidth = () => commandPaletteContentWidth(columnCount())

    return (
        <box flexDirection="column" width={modalWidth()} height="80%">
            <box height={1} flexShrink={0} overflow="hidden">
                <input
                    ref={(r) => {
                        searchInputRef = r
                        setTimeout(() => {
                            r.requestRender?.()
                            r.focus()
                        }, 1)
                    }}
                    onContentChange={() => {
                        if (searchInputRef) setFilter(searchInputRef.plainText)
                    }}
                    onSubmit={() => executeSelected()}
                    keyBindings={SINGLE_LINE_KEYBINDINGS}
                    placeholder="Search"
                    placeholderColor={colors().textMuted}
                    cursorColor={colors().primary}
                    textColor={colors().textMuted}
                    focusedTextColor={colors().text}
                    focusedBackgroundColor={RGBA.fromInts(0, 0, 0, 0)}
                    width="100%"
                />
            </box>
            <box height={1} flexShrink={0} />

            <scrollbox
                ref={scrollRef}
                flexGrow={1}
                scrollX={false}
                horizontalScrollbarOptions={{ visible: false }}
            >
                <box
                    flexDirection="row"
                    gap={columnGap()}
                    paddingRight={COMMAND_PALETTE_SCROLLBAR_GUTTER}
                >
                    <For each={filteredColumns()}>
                        {(column) => (
                            <box flexDirection="column" width={32}>
                                <For each={column}>
                                    {(group) => (
                                        <box
                                            flexDirection="column"
                                            marginBottom={1}
                                        >
                                            <text fg={colors().primary}>
                                                {group.label}
                                            </text>
                                            <For each={group.commands}>
                                                {(cmd) => (
                                                    <box
                                                        flexDirection="row"
                                                        justifyContent="space-between"
                                                        backgroundColor={
                                                            isSelected(cmd)
                                                                ? colors()
                                                                      .selectionBackground
                                                                : undefined
                                                        }
                                                    >
                                                        <text
                                                            fg={
                                                                isSelected(cmd)
                                                                    ? colors()
                                                                          .selectionText
                                                                    : isNavigatable(
                                                                            cmd,
                                                                        )
                                                                      ? colors()
                                                                            .text
                                                                      : colors()
                                                                            .textMuted
                                                            }
                                                        >
                                                            {cmd.title}
                                                        </text>
                                                        <Show
                                                            when={cmd.keybind}
                                                        >
                                                            {(
                                                                kb: Accessor<KeybindConfigKey>,
                                                            ) => (
                                                                <text
                                                                    fg={
                                                                        isSelected(
                                                                            cmd,
                                                                        )
                                                                            ? colors()
                                                                                  .selectionText
                                                                            : colors()
                                                                                  .textMuted
                                                                    }
                                                                    wrapMode="none"
                                                                >
                                                                    {command.keyLabel(
                                                                        cmd.id,
                                                                    )}
                                                                </text>
                                                            )}
                                                        </Show>
                                                    </box>
                                                )}
                                            </For>
                                        </box>
                                    )}
                                </For>
                            </box>
                        )}
                    </For>
                </box>
            </scrollbox>
        </box>
    )
}
