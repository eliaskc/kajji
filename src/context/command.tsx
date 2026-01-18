import { useKeyboard } from "@opentui/solid"
import { type Accessor, createMemo, createSignal, onCleanup } from "solid-js"
import type { KeybindConfigKey } from "../keybind"
import { useDialog } from "./dialog"
import { useFocus } from "./focus"
import { createSimpleContext } from "./helper"
import { useKeybind } from "./keybind"
import type { CommandType, CommandVisibility, Context, Panel } from "./types"

export type { CommandType, CommandVisibility, Context }

export type CommandOption = {
	id: string
	title: string
	keybind?: KeybindConfigKey
	context: Context
	type: CommandType
	panel?: Panel
	visibility?: CommandVisibility
	onSelect: () => void
}

function contextMatches(
	commandContext: Context,
	activeContext: Context,
): boolean {
	if (commandContext === "global") return true
	if (commandContext === activeContext) return true
	return activeContext.startsWith(`${commandContext}.`)
}

export const { use: useCommand, provider: CommandProvider } =
	createSimpleContext({
		name: "Command",
		init: () => {
			const [registrations, setRegistrations] = createSignal<
				Accessor<CommandOption[]>[]
			>([])
			const [inputMode, setInputMode] = createSignal(false)
			const keybind = useKeybind()
			const focus = useFocus()
			const dialog = useDialog()

			const allCommands = createMemo(() => {
				return registrations().flatMap((r) => r())
			})

			useKeyboard((evt) => {
				const dialogOpen = dialog.isOpen()
				const isInputMode = inputMode()
				const activeCtx = focus.activeContext()
				const activePanel = focus.panel()

				let mostSpecificMatch: CommandOption | null = null
				let highestContextSpecificity = -1

				for (const cmd of allCommands()) {
					// Block all commands when dialog is open (except help)
					if (dialogOpen && cmd.keybind !== "help") {
						continue
					}

					// Block all commands when in input mode (e.g., filtering)
					if (isInputMode) {
						continue
					}

					if (!dialogOpen) {
						if (!contextMatches(cmd.context, activeCtx)) {
							continue
						}
						if (cmd.panel && cmd.panel !== activePanel) {
							continue
						}
					}

					if (cmd.keybind && keybind.match(cmd.keybind, evt)) {
						const contextSpecificity =
							cmd.context === activeCtx
								? Number.MAX_SAFE_INTEGER
								: cmd.context.length
						if (contextSpecificity > highestContextSpecificity) {
							mostSpecificMatch = cmd
							highestContextSpecificity = contextSpecificity
						}
					}
				}

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
						setRegistrations((arr) => arr.filter((r) => r !== accessor))
					})
				},

				trigger: (id: string) => {
					const cmd = allCommands().find((c) => c.id === id)
					cmd?.onSelect()
				},

				all: allCommands,

				// Input mode blocks all commands (for inline filtering, etc.)
				setInputMode,
				isInputMode: inputMode,
			}
		},
	})
