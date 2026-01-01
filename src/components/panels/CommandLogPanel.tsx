import { For, Show } from "solid-js"
import { useCommandLog } from "../../context/commandlog"
import { useTheme } from "../../context/theme"

export function CommandLogPanel() {
	const { colors, style } = useTheme()
	const commandLog = useCommandLog()

	return (
		<box
			flexDirection="column"
			border
			borderStyle={style().panel.borderStyle}
			borderColor={colors().border}
			title="Command log"
			height={6}
			overflow="hidden"
		>
			<scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
				<Show
					when={commandLog.entries().length > 0}
					fallback={
						<text fg={colors().textMuted}>No commands executed yet</text>
					}
				>
					<For each={commandLog.entries()}>
						{(entry) => (
							<box flexDirection="column">
								<text fg={colors().textMuted}>$ {entry.command}</text>
								<text fg={entry.success ? colors().success : colors().error}>
									{entry.output}
								</text>
							</box>
						)}
					</For>
				</Show>
			</scrollbox>
		</box>
	)
}
