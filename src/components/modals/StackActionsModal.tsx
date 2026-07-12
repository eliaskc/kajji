import { useKeyboard } from "@opentui/solid"
import { For, Show, createSignal } from "solid-js"
import type { Bookmark } from "../../commander/bookmarks"
import { useDialogCommands } from "../../context/command"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import type { BookmarkStackRow } from "../../stack/model"
import { BookmarkStackRowView } from "../BookmarkStackRowView"

export interface StackActionOption {
    key: string
    mutedPrefix?: string
    label: string
    onSelect: () => void
}

interface StackActionsModalProps {
    stackRootName: string
    rows: readonly BookmarkStackRow<Bookmark>[]
    prNumbers: ReadonlyMap<string, number>
    actions: readonly StackActionOption[]
}

export function StackActionsModal(props: StackActionsModalProps) {
    const dialog = useDialog()
    const { colors } = useTheme()
    const [selectedIndex, setSelectedIndex] = createSignal(0)

    let executing = false

    const execute = (index: number) => {
        const action = props.actions[index]
        if (!action || executing) return
        executing = true
        dialog.close()
        action.onSelect()
    }

    const selectNext = () => {
        if (props.actions.length === 0) return
        setSelectedIndex((index) =>
            Math.min(props.actions.length - 1, index + 1),
        )
    }

    const selectPrev = () => {
        if (props.actions.length === 0) return
        setSelectedIndex((index) => Math.max(0, index - 1))
    }

    const dialogId = dialog.currentId()
    useDialogCommands(dialogId, () => [
        {
            id: `${dialogId}.next`,
            title: "next",
            keybind: "nav_down",
            visibleIn: [],
            execute: selectNext,
        },
        {
            id: `${dialogId}.previous`,
            title: "previous",
            keybind: "nav_up",
            visibleIn: [],
            execute: selectPrev,
        },
        {
            id: `${dialogId}.select`,
            title: "select",
            keybind: "enter",
            execute: () => execute(selectedIndex()),
        },
    ])

    useKeyboard((evt) => {
        if (evt.name && evt.name.length === 1) {
            const key = evt.shift ? evt.name.toUpperCase() : evt.name
            const index = props.actions.findIndex(
                (action) => action.key === key,
            )
            if (index >= 0) {
                evt.preventDefault()
                evt.stopPropagation()
                execute(index)
            }
        }
    })

    return (
        <box flexDirection="column" gap={1} minHeight={10}>
            <box flexDirection="column">
                <For each={props.rows}>
                    {(row) => (
                        <box flexDirection="row" overflow="hidden">
                            <BookmarkStackRowView
                                row={row}
                                prNumber={props.prNumbers.get(
                                    row.bookmark.name,
                                )}
                                hideDescription
                            />
                        </box>
                    )}
                </For>
            </box>

            <box flexDirection="column">
                <For each={props.actions}>
                    {(action, index) => (
                        <box
                            flexDirection="row"
                            justifyContent="space-between"
                            backgroundColor={
                                index() === selectedIndex()
                                    ? colors().selectionBackground
                                    : undefined
                            }
                            onMouseDown={() => setSelectedIndex(index())}
                        >
                            <text wrapMode="none" flexGrow={1}>
                                <Show when={action.mutedPrefix}>
                                    <span style={{ fg: colors().textMuted }}>
                                        {action.mutedPrefix}
                                    </span>
                                </Show>
                                <span style={{ fg: colors().text }}>
                                    {action.label}
                                </span>
                            </text>
                            <text wrapMode="none" fg={colors().primary}>
                                {action.key}
                            </text>
                        </box>
                    )}
                </For>
            </box>
        </box>
    )
}
