import { useKeyboard } from "@opentui/solid"
import { For, createSignal } from "solid-js"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"

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
        setSelectedIndex((i) => Math.min(props.options.length - 1, i + 1))
    }

    const selectPrev = () => {
        if (props.options.length === 0) return
        setSelectedIndex((i) => Math.max(0, i - 1))
    }

    useKeyboard((evt) => {
        if (evt.name === "escape") {
            evt.preventDefault()
            evt.stopPropagation()
            dialog.close()
            return
        }

        if (evt.name === "down") {
            evt.preventDefault()
            evt.stopPropagation()
            selectNext()
            return
        }

        if (evt.name === "up") {
            evt.preventDefault()
            evt.stopPropagation()
            selectPrev()
            return
        }

        if (evt.name === "return" || evt.name === "enter") {
            evt.preventDefault()
            evt.stopPropagation()
            execute(selectedIndex())
            return
        }

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
                            index() === selectedIndex()
                                ? colors().selectionBackground
                                : undefined
                        }
                        onMouseDown={() => setSelectedIndex(index())}
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
