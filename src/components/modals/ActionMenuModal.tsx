import { useKeyboard } from "@opentui/solid"
import { For, createSignal } from "solid-js"
import { useDialogCommands } from "../../context/command"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { createSelectableList } from "../../hooks/selectable-list"

export interface ActionMenuOption {
    key: string
    label: string
    mutedPrefix?: string
    detail?: string
    onSelect: () => void
}

interface ActionMenuModalProps {
    options: ActionMenuOption[]
    paddingLeft?: number
    paddingRight?: number
}

export function ActionMenuModal(props: ActionMenuModalProps) {
    const dialog = useDialog()
    const { colors } = useTheme()
    const [selectedIndex, setSelectedIndex] = createSignal(0)
    const list = createSelectableList({
        count: () => props.options.length,
        selectedIndex,
        setSelectedIndex,
    })

    let executing = false

    const execute = (index: number) => {
        const option = props.options[index]
        if (!option || executing) return
        executing = true
        dialog.close()
        option.onSelect()
    }

    const selectNext = () => {
        if (props.options.length === 0) return
        list.selectNextByKeyboard()
    }

    const selectPrev = () => {
        if (props.options.length === 0) return
        list.selectPrevByKeyboard()
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
            const pressed = evt.name.toLowerCase()
            const index = props.options.findIndex(
                (option) => option.key.toLowerCase() === pressed,
            )
            if (index >= 0) {
                evt.preventDefault()
                evt.stopPropagation()
                execute(index)
            }
        }
    })

    return (
        <box flexDirection="column" minHeight={8}>
            <For each={props.options}>
                {(option, index) => (
                    <box
                        flexDirection="row"
                        justifyContent="space-between"
                        paddingLeft={props.paddingLeft ?? 0}
                        paddingRight={props.paddingRight ?? 0}
                        backgroundColor={
                            list.isSelected(index())
                                ? colors().selectionBackground
                                : undefined
                        }
                        onMouseDown={() => list.selectByMouse(index())}
                    >
                        <text wrapMode="none" flexGrow={1}>
                            {option.mutedPrefix ? (
                                <span style={{ fg: colors().textMuted }}>
                                    {option.mutedPrefix}
                                </span>
                            ) : null}
                            <span style={{ fg: colors().text }}>
                                {option.label}
                            </span>
                        </text>
                        <box flexDirection="row" gap={1}>
                            {option.detail ? (
                                <text wrapMode="none" fg={colors().textMuted}>
                                    {option.detail}
                                </text>
                            ) : null}
                            <text wrapMode="none" fg={colors().primary}>
                                {option.key}
                            </text>
                        </box>
                    </box>
                )}
            </For>
        </box>
    )
}
