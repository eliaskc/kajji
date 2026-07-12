import { useKeyboard } from "@opentui/solid"
import {
    type Accessor,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
} from "solid-js"
import { type CommandDefinition, resolveCommandKey } from "../command/policy"
import { useDialog } from "./dialog"
import { useFocus } from "./focus"
import { createSimpleContext } from "./helper"
import { useKeybind } from "./keybind"
import type { CommandType, CommandVisibility, Context } from "./types"

export type { CommandType, CommandVisibility, Context }

export type CommandOption = CommandDefinition

export const { use: useCommand, provider: CommandProvider } =
    createSimpleContext({
        name: "Command",
        init: () => {
            const [registrations, setRegistrations] = createSignal<
                Accessor<CommandOption[]>[]
            >([])
            const [inputMode, setInputMode] = createSignal(false)
            const [focusedInputCount, setFocusedInputCount] = createSignal(0)
            const keybind = useKeybind()
            const focus = useFocus()
            const dialog = useDialog()

            const allCommands = createMemo(() => {
                return registrations().flatMap((r) => r())
            })

            const isBlockingCommands = () =>
                inputMode() || focusedInputCount() > 0

            useKeyboard((evt) => {
                const dialogOpen = dialog.isOpen()
                const isInputMode = isBlockingCommands()
                const activeCtx = focus.activeContext()
                const activePanel = focus.panel()

                const mostSpecificMatch = resolveCommandKey(
                    allCommands(),
                    evt,
                    {
                        context: activeCtx,
                        panel: activePanel,
                        dialogOpen,
                        inputMode: isInputMode,
                    },
                    (configKey, event) => keybind.match(configKey, event),
                )

                if (mostSpecificMatch) {
                    evt.preventDefault()
                    evt.stopPropagation()
                    mostSpecificMatch.onSelect()
                }
            })

            return {
                register: (cb: () => CommandOption[]) => {
                    const accessor = createMemo(cb)
                    setRegistrations((arr) => [...arr, accessor])
                    onCleanup(() => {
                        setRegistrations((arr) =>
                            arr.filter((r) => r !== accessor),
                        )
                    })
                },

                trigger: (id: string) => {
                    const cmd = allCommands().find((c) => c.id === id)
                    cmd?.onSelect()
                },

                all: allCommands,

                // Input mode blocks all commands (for inline filtering, etc.)
                setInputMode,
                isInputMode: isBlockingCommands,
                registerFocusedInput: () => {
                    setFocusedInputCount((count) => count + 1)
                    let released = false
                    return () => {
                        if (released) return
                        released = true
                        setFocusedInputCount((count) => Math.max(0, count - 1))
                    }
                },
            }
        },
    })

export function useCommandInputGuard() {
    const command = useCommand()
    let releaseFocus: (() => void) | undefined

    onMount(() => {
        releaseFocus = command.registerFocusedInput()
    })

    onCleanup(() => {
        releaseFocus?.()
    })
}
