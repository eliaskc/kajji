import { Match, Switch } from "solid-js"
import { useFocus } from "../context/focus"
import { useLayout } from "../context/layout"
import { useTheme } from "../context/theme"
import { StatusBar } from "./StatusBar"
import { BookmarksPanel } from "./panels/BookmarksPanel"
import { CommandLogPanel } from "./panels/CommandLogPanel"
import { LogPanel } from "./panels/LogPanel"
import { MainArea } from "./panels/MainArea"

function VerticalDivider() {
	const { colors } = useTheme()
	return (
		<box width={1} overflow="hidden">
			<text fg={colors().backgroundElement}>{"│\n".repeat(300)}</text>
		</box>
	)
}

function HorizontalDivider() {
	const { colors } = useTheme()
	return (
		<box height={1} overflow="hidden">
			<text fg={colors().backgroundElement}>{"─".repeat(500)}</text>
		</box>
	)
}

function NormalLayout() {
	return (
		<box flexDirection="row" flexGrow={1} gap={0}>
			<box flexGrow={1} flexBasis={0} flexDirection="column" gap={0}>
				<box flexGrow={3} flexBasis={0}>
					<LogPanel />
				</box>
				<HorizontalDivider />
				<box flexGrow={1} flexBasis={0}>
					<BookmarksPanel />
				</box>
			</box>
			<VerticalDivider />
			<box flexGrow={1} flexBasis={0} flexDirection="column">
				<box flexGrow={1}>
					<MainArea />
				</box>
				<HorizontalDivider />
				<CommandLogPanel />
			</box>
		</box>
	)
}

function FocusLayout() {
	const focus = useFocus()
	const activePanel = () => focus.panel()
	const leftGrow = () =>
		activePanel() === "log" || activePanel() === "refs" ? 3 : 2
	const rightGrow = () =>
		activePanel() === "detail" || activePanel() === "commandlog"
			? 7
			: activePanel() === "log" || activePanel() === "refs"
				? 2
				: 3
	const logGrow = () => (activePanel() === "refs" ? 2 : 3)
	const refsGrow = () => (activePanel() === "refs" ? 3 : 1)
	const detailGrow = () => (activePanel() === "detail" ? 7 : 1)

	return (
		<box flexDirection="row" flexGrow={1} gap={0}>
			<box flexGrow={leftGrow()} flexBasis={0} flexDirection="column" gap={0}>
				<box flexGrow={logGrow()} flexBasis={0}>
					<LogPanel />
				</box>
				<HorizontalDivider />
				<box flexGrow={refsGrow()} flexBasis={0}>
					<BookmarksPanel />
				</box>
			</box>
			<VerticalDivider />
			<box flexGrow={rightGrow()} flexBasis={0} flexDirection="column">
				<box flexGrow={detailGrow()} flexBasis={0}>
					<MainArea />
				</box>
				<HorizontalDivider />
				<CommandLogPanel />
			</box>
		</box>
	)
}

export function LayoutGrid() {
	const { colors } = useTheme()
	const { focusMode } = useLayout()

	return (
		<box
			flexGrow={1}
			flexDirection="column"
			width="100%"
			height="100%"
			backgroundColor={colors().background}
			paddingTop={0}
			paddingBottom={0}
			gap={0}
		>
			<Switch>
				<Match when={focusMode() === "normal"}>
					<NormalLayout />
				</Match>
				<Match when={focusMode() === "focus"}>
					<FocusLayout />
				</Match>
			</Switch>
			<box height={1} flexShrink={0} />
			<StatusBar />
		</box>
	)
}
