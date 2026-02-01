import { Match, Show, Switch } from "solid-js"
import { useDimmer } from "../context/dimmer"
import { useFocus } from "../context/focus"
import { useLayout } from "../context/layout"
import { useTheme } from "../context/theme"
import { Dimmer } from "./Dimmer"
import { StatusBar } from "./StatusBar"
import { BookmarksPanel } from "./panels/BookmarksPanel"
import { CommandLogPanel } from "./panels/CommandLogPanel"
import { LogPanel } from "./panels/LogPanel"
import { MainArea } from "./panels/MainArea"

function NormalLayout() {
	const dimmer = useDimmer()

	return (
		<box flexDirection="row" flexGrow={1} gap={0}>
			<box flexGrow={1} flexBasis={0} flexDirection="column" gap={0}>
				<box flexGrow={3} flexBasis={0}>
					<Dimmer dimmed={dimmer.isDimmed("log")} grow>
						<LogPanel />
					</Dimmer>
				</box>
				<box flexGrow={1} flexBasis={0}>
					<Dimmer dimmed={dimmer.isDimmed("refs")} grow>
						<BookmarksPanel />
					</Dimmer>
				</box>
			</box>
			<box flexGrow={1} flexBasis={0} flexDirection="column">
				<box flexGrow={1}>
					<Dimmer dimmed={dimmer.isDimmed("detail")} grow>
						<MainArea />
					</Dimmer>
				</box>
				<Dimmer dimmed={dimmer.isDimmed("commandlog")}>
					<CommandLogPanel />
				</Dimmer>
			</box>
		</box>
	)
}

function DiffLayout() {
	const focus = useFocus()
	const dimmer = useDimmer()
	const isRefsFocused = () => focus.isPanel("refs")

	return (
		<box flexDirection="row" flexGrow={1} gap={0}>
			<box flexGrow={1} flexBasis={0} flexDirection="column">
				<Show
					when={isRefsFocused()}
					fallback={
						<Dimmer dimmed={dimmer.isDimmed("log")} grow>
							<LogPanel />
						</Dimmer>
					}
				>
					<Dimmer dimmed={dimmer.isDimmed("refs")} grow>
						<BookmarksPanel />
					</Dimmer>
				</Show>
			</box>
			<box flexGrow={4} flexBasis={0} flexDirection="column">
				<box flexGrow={1}>
					<Dimmer dimmed={dimmer.isDimmed("detail")} grow>
						<MainArea />
					</Dimmer>
				</box>
			</box>
		</box>
	)
}

export function LayoutGrid() {
	const { colors, style } = useTheme()
	const { focusMode } = useLayout()

	return (
		<box
			flexGrow={1}
			flexDirection="column"
			width="100%"
			height="100%"
			backgroundColor={colors().background}
			padding={style().adaptToTerminal ? 0 : 1}
			gap={0}
		>
			<Switch>
				<Match when={focusMode() === "normal"}>
					<NormalLayout />
				</Match>
				<Match when={focusMode() === "diff"}>
					<DiffLayout />
				</Match>
			</Switch>
			<StatusBar />
		</box>
	)
}
