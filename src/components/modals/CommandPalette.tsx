import {
    type InputRenderable,
    RGBA,
    type ScrollBoxRenderable,
} from "@opentui/core"

const COMMAND_PALETTE_CONTENT_WIDTH = 50

export function commandPaletteContentWidth() {
    return COMMAND_PALETTE_CONTENT_WIDTH
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
    useDialogCommands,
} from "../../context/command"
import { useDialog } from "../../context/dialog"
import { useLayout } from "../../context/layout"
import { useTheme } from "../../context/theme"
import type { KeybindConfigKey } from "../../keybind"

interface ContextGroupData {
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

const capitalize = (value: string) =>
    value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value

export function CommandPalette() {
    const command = useCommand()
    useCommandInputGuard()
    const dialog = useDialog()
    const layout = useLayout()
    const { colors } = useTheme()
    const [filter, setFilter] = createSignal("")
    const [selectedIndex, setSelectedIndex] = createSignal(0)
    const [scrollTop, setScrollTop] = createSignal(0)
    let searchInputRef: InputRenderable | undefined
    let scrollRef: ScrollBoxRenderable | undefined

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
        filter()
        setSelectedIndex(0)
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
                    label: GROUP_LABELS[group],
                    commands,
                })
            }
        }

        return result
    })

    const filteredGroups = createMemo((): ContextGroupData[] => {
        const matched = matchedIds()
        const groups = groupedCommands()
        const activeGroups = groups
            .map((group) => ({
                ...group,
                commands: group.commands.filter(
                    (cmd) => matched.has(cmd.id) && isActive(cmd),
                ),
            }))
            .filter((group) => group.commands.length > 0)

        const unavailable = groups.flatMap((group) =>
            group.commands.filter(
                (cmd) => matched.has(cmd.id) && !isActive(cmd),
            ),
        )

        if (unavailable.length > 0) {
            activeGroups.push({ label: "unavailable", commands: unavailable })
        }

        return activeGroups
    })

    const matchedInColumnOrder = createMemo(() => {
        return filteredGroups().flatMap((group) =>
            group.commands.filter(isActive),
        )
    })

    const selectedCommand = createMemo(() => {
        const idx = selectedIndex()
        if (idx < 0) return null
        return matchedInColumnOrder()[idx] ?? null
    })

    const isNavigatable = (cmd: CommandOption) => {
        return matchedIds().has(cmd.id) && isActive(cmd)
    }

    const getRowPositionForCommand = (cmd: CommandOption): number => {
        let row = 0
        for (const group of filteredGroups()) {
            row += 1
            for (const command of group.commands) {
                if (command.id === cmd.id) {
                    return row
                }
                row += 1
            }
            row += 1
        }
        return 0
    }

    const scrollIntoView = (cmd: CommandOption | null) => {
        if (!scrollRef || !cmd) return
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

    const dialogId = dialog.currentId()
    useDialogCommands(dialogId, () => [
        {
            id: `${dialogId}.next`,
            title: "next",
            keybind: "input_nav_down",
            visibleIn: [],
            allowInInput: true,
            execute: () => move(1),
        },
        {
            id: `${dialogId}.previous`,
            title: "previous",
            keybind: "input_nav_up",
            visibleIn: [],
            allowInInput: true,
            execute: () => move(-1),
        },
    ])

    const isSelected = (cmd: CommandOption) => selectedCommand()?.id === cmd.id
    const paletteHeight = () =>
        Math.min(30, Math.max(12, layout.terminalHeight() - 6))

    return (
        <box
            flexDirection="column"
            width={commandPaletteContentWidth()}
            height={paletteHeight()}
        >
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
                height={paletteHeight() - 2}
                width={COMMAND_PALETTE_CONTENT_WIDTH + 4}
                marginLeft={-2}
                scrollX={false}
                horizontalScrollbarOptions={{ visible: false }}
                verticalScrollbarOptions={{ visible: false }}
            >
                <box
                    flexDirection="column"
                    width={COMMAND_PALETTE_CONTENT_WIDTH + 4}
                >
                    <For each={filteredGroups()}>
                        {(group) => (
                            <box flexDirection="column" marginBottom={1}>
                                <box paddingLeft={2} paddingRight={2}>
                                    <text fg={colors().primary}>
                                        {capitalize(group.label)}
                                    </text>
                                </box>
                                <For each={group.commands}>
                                    {(cmd) => (
                                        <box
                                            flexDirection="row"
                                            width={
                                                COMMAND_PALETTE_CONTENT_WIDTH +
                                                4
                                            }
                                            paddingLeft={2}
                                            paddingRight={2}
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
                                                        ? colors().selectionText
                                                        : isNavigatable(cmd)
                                                          ? colors().text
                                                          : colors().textMuted
                                                }
                                                wrapMode="none"
                                            >
                                                {capitalize(cmd.title)}
                                                <Show when={cmd.description}>
                                                    {(
                                                        description: Accessor<string>,
                                                    ) => (
                                                        <span
                                                            style={{
                                                                fg: isSelected(
                                                                    cmd,
                                                                )
                                                                    ? colors()
                                                                          .selectionText
                                                                    : colors()
                                                                          .textMuted,
                                                            }}
                                                        >
                                                            {` ${description()}`}
                                                        </span>
                                                    )}
                                                </Show>
                                            </text>
                                            <Show when={cmd.keybind}>
                                                {(
                                                    kb: Accessor<KeybindConfigKey>,
                                                ) => (
                                                    <text
                                                        fg={
                                                            isSelected(cmd)
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
            </scrollbox>
        </box>
    )
}
