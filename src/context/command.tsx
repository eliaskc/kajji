import { useKeyboard } from "@opentui/solid"
import {
    type Accessor,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
} from "solid-js"
import {
    type CommandDefinition,
    type CommandSurface,
    canDispatchCommand,
    commandsForSurface,
    isCommandApplicable,
    isCommandVisible,
    resolveCommandKey,
} from "../command/policy"
import { useDialog } from "./dialog"
import { useFocus } from "./focus"
import { createSimpleContext } from "./helper"
import { useKeybind } from "./keybind"
import type { Context } from "./types"

export type { Context }

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

            const environment = () => ({
                context: focus.activeContext(),
                panel: focus.panel(),
                dialogOpen: dialog.isOpen(),
                dialogId: dialog.current()?.id,
                inputMode: isBlockingCommands(),
            })

            const paletteEnvironment = () => {
                const current = dialog.current()
                if (current?.id !== "commandPalette") return environment()
                const previous = dialog.previous()
                return {
                    ...environment(),
                    dialogOpen: previous !== undefined,
                    dialogId: previous?.id,
                    inputMode: false,
                }
            }

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
                        dialogId: dialog.current()?.id,
                        inputMode: isInputMode,
                    },
                    (configKey, event) => keybind.match(configKey, event),
                )

                if (mostSpecificMatch) {
                    evt.preventDefault()
                    evt.stopPropagation()
                    mostSpecificMatch.execute()
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

                execute: (id: string) => {
                    const cmd = allCommands().find((c) => c.id === id)
                    if (!cmd || !canDispatchCommand(cmd, environment()))
                        return false
                    cmd.execute()
                    return true
                },

                all: allCommands,
                forSurface: (surface: CommandSurface) =>
                    commandsForSurface(allCommands(), surface),
                activeForSurface: (surface: CommandSurface) =>
                    allCommands().filter(
                        (cmd) =>
                            isCommandVisible(cmd, surface) &&
                            isCommandApplicable(cmd, environment()),
                    ),
                isActive: (id: string) => {
                    const cmd = allCommands().find((item) => item.id === id)
                    return cmd
                        ? canDispatchCommand(cmd, paletteEnvironment())
                        : false
                },
                keyLabel: (id: string) => {
                    const cmd = allCommands().find((item) => item.id === id)
                    return cmd?.keybind ? keybind.print(cmd.keybind) : ""
                },

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

export type DialogCommandOption = Omit<
    CommandOption,
    "context" | "dialogId" | "scope" | "visibleIn"
> & {
    allowInInput?: boolean
    visibleIn?: readonly CommandSurface[]
}

export function useDialogCommands(
    dialogId: string,
    definitions: () => DialogCommandOption[],
) {
    const command = useCommand()
    const dialog = useDialog()
    const keybind = useKeybind()

    command.register(() =>
        definitions().map((definition) => ({
            ...definition,
            visibleIn: definition.visibleIn ?? ["dialog"],
            context: "global" as const,
            dialogId,
            scope: "dialog" as const,
        })),
    )

    createEffect(() => {
        const hints = commandsForSurface(command.all(), "dialog")
            .filter(
                (definition) =>
                    definition.scope === "dialog" &&
                    definition.dialogId === dialogId &&
                    definition.keybind,
            )
            .map((definition) => ({
                key: definition.keybind
                    ? keybind.print(definition.keybind)
                    : "",
                label: definition.hintLabel ?? definition.title,
            }))
        dialog.setGeneratedHints(dialogId, hints)
    })

    onCleanup(() => dialog.clearGeneratedHints(dialogId))
}
