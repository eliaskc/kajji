import { For, Show, createMemo } from "solid-js"
import { useCommand } from "../context/command"
import { useFocus } from "../context/focus"
import { useKeybind } from "../context/keybind"
import { useLayout } from "../context/layout"
import { useTheme } from "../context/theme"
import type { Context } from "../context/types"
import { getCurrentVersion } from "../utils/update"

function contextMatches(
	commandContext: Context,
	activeContext: Context,
): boolean {
	if (commandContext === "global") return true
	return commandContext === activeContext
}

export function StatusBar() {
	const command = useCommand()
	const focus = useFocus()
	const keybind = useKeybind()
	const layout = useLayout()
	const { colors, style } = useTheme()

	const relevantCommands = createMemo(() => {
		const all = command.all()
		const activeCtx = focus.activeContext()
		const activePanel = focus.panel()

		const isRelevant = (cmd: (typeof all)[0]) => {
			if (!cmd.keybind) return false
			if (!contextMatches(cmd.context, activeCtx)) return false
			if (cmd.panel && cmd.panel !== activePanel) return false
			return true
		}

		const isVisibleInStatusBar = (cmd: (typeof all)[0]) => {
			const v = cmd.visibility ?? "all"
			return v === "all" || v === "status-only"
		}

		const contextCmds = all.filter(
			(cmd) => isRelevant(cmd) && cmd.context !== "global",
		)
		const globalCmds = all.filter(
			(cmd) => isRelevant(cmd) && cmd.context === "global",
		)

		const seen = new Set<string>()
		return [...contextCmds, ...globalCmds].filter((cmd) => {
			if (!isVisibleInStatusBar(cmd)) return false
			if (seen.has(cmd.id)) return false
			seen.add(cmd.id)
			return true
		})
	})

	const contextCommands = createMemo(() =>
		relevantCommands().filter((cmd) => cmd.context !== "global"),
	)
	const globalCommands = createMemo(() =>
		relevantCommands().filter((cmd) => cmd.context === "global"),
	)

	const separator = () => style().statusBar.separator
	const isFocusMode = () => layout.focusMode() === "focus"

	const commandGap = separator() ? ` ${separator()} ` : "   "

	return (
		<box height={1} flexShrink={0} flexDirection="row">
			<>
				<box
					flexShrink={0}
					backgroundColor={isFocusMode() ? colors().titleBarFocused : undefined}
				>
					<text
						wrapMode="none"
						fg={isFocusMode() ? colors().titleTextFocused : colors().textMuted}
					>
						{isFocusMode() ? " FOCUS " : " NORMAL"}
					</text>
				</box>
				<box width={1} />
				<box flexGrow={1} overflow="hidden">
					<text wrapMode="none">
						<For each={contextCommands()}>
							{(cmd, index) => (
								<>
									<span style={{ fg: colors().statusBarKey }}>
										{cmd.keybind ? keybind.print(cmd.keybind) : ""}
									</span>{" "}
									<span style={{ fg: colors().textMuted }}>{cmd.title}</span>
									<Show when={index() < contextCommands().length - 1}>
										<span
											style={{
												fg: separator() ? colors().textMuted : undefined,
											}}
										>
											{commandGap}
										</span>
									</Show>
								</>
							)}
						</For>
					</text>
				</box>
				<Show when={globalCommands().length > 0}>
					<box flexShrink={0}>
						<text wrapMode="none">
							<For each={globalCommands()}>
								{(cmd, index) => (
									<>
										<Show when={index() > 0}>
											<span
												style={{
													fg: separator() ? colors().textMuted : undefined,
												}}
											>
												{commandGap}
											</span>
										</Show>
										<span style={{ fg: colors().statusBarKey }}>
											{cmd.keybind ? keybind.print(cmd.keybind) : ""}
										</span>{" "}
										<span style={{ fg: colors().textMuted }}>{cmd.title}</span>
									</>
								)}
							</For>
						</text>
					</box>
				</Show>
				<box flexShrink={0} marginLeft={2}>
					<text fg={colors().textMuted} wrapMode="none">
						v{getCurrentVersion()}
					</text>
				</box>
			</>
		</box>
	)
}
