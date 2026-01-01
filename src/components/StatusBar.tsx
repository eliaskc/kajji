import { For, Show, createMemo } from "solid-js"
import { useCommand } from "../context/command"
import { useFocus } from "../context/focus"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"

export function StatusBar() {
	const command = useCommand()
	const focus = useFocus()
	const keybind = useKeybind()
	const { colors, style } = useTheme()

	const relevantCommands = createMemo(() => {
		const all = command.all()
		const activeCtx = focus.activeContext()
		const activePanel = focus.panel()

		const isRelevant = (cmd: (typeof all)[0]) => {
			if (!cmd.keybind) return false
			if (cmd.context !== activeCtx && cmd.context !== "global") return false
			if (cmd.panel && cmd.panel !== activePanel) return false
			return true
		}

		const contextCmds = all.filter(
			(cmd) => isRelevant(cmd) && cmd.context !== "global",
		)
		const globalCmds = all.filter(
			(cmd) => isRelevant(cmd) && cmd.context === "global",
		)

		const seen = new Set<string>()
		return [...contextCmds, ...globalCmds].filter((cmd) => {
			if (cmd.hidden) return false
			if (seen.has(cmd.id)) return false
			seen.add(cmd.id)
			return true
		})
	})

	const separator = () => style().statusBar.separator
	const gap = () => (separator() ? 0 : 3)

	return (
		<box
			height={1}
			flexShrink={0}
			paddingLeft={1}
			paddingRight={1}
			flexDirection="row"
			gap={gap()}
		>
			<For each={relevantCommands()}>
				{(cmd, index) => (
					<text>
						<span style={{ fg: colors().primary }}>
							{cmd.keybind ? keybind.print(cmd.keybind) : ""}
						</span>{" "}
						<span style={{ fg: colors().text }}>{cmd.title}</span>
						<Show when={separator() && index() < relevantCommands().length - 1}>
							<span style={{ fg: colors().textMuted }}>
								{` ${separator()} `}
							</span>
						</Show>
					</text>
				)}
			</For>
		</box>
	)
}
