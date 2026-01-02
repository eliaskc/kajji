import { For, type JSX, Show } from "solid-js"
import { useCommand } from "../context/command"
import { useTheme } from "../context/theme"
import type { Context, Panel as PanelType } from "../context/types"
import { BorderBox } from "./BorderBox"

interface Tab {
	id: string
	label: string
	context: Context
}

interface PanelProps {
	title?: string
	tabs?: Tab[]
	activeTab?: string
	onTabChange?: (tabId: string) => void
	panelId?: PanelType
	hotkey: string
	focused: boolean
	children: JSX.Element
}

export function Panel(props: PanelProps) {
	const { colors, style } = useTheme()
	const command = useCommand()

	const hasTabs = () => props.tabs && props.tabs.length > 1

	const cycleTab = (direction: 1 | -1) => {
		if (!props.tabs || props.tabs.length <= 1 || !props.onTabChange) return
		const currentIndex = props.tabs.findIndex((t) => t.id === props.activeTab)
		const nextIndex =
			(currentIndex + direction + props.tabs.length) % props.tabs.length
		const nextTab = props.tabs[nextIndex]
		if (nextTab) props.onTabChange(nextTab.id)
	}

	command.register(() => {
		if (!hasTabs() || !props.panelId) return []

		return [
			{
				id: `${props.panelId}.next_tab`,
				title: "Next tab",
				keybind: "next_tab",
				context: props.panelId,
				type: "navigation",
				panel: props.panelId,
				onSelect: () => cycleTab(1),
			},
			{
				id: `${props.panelId}.prev_tab`,
				title: "Previous tab",
				keybind: "prev_tab",
				context: props.panelId,
				type: "navigation",
				panel: props.panelId,
				onSelect: () => cycleTab(-1),
			},
		]
	})

	const renderTitle = () => {
		if (hasTabs()) {
			return (
				<text>
					<span style={{ fg: colors().textMuted }}>[{props.hotkey}]─</span>
					<For each={props.tabs}>
						{(tab, i) => (
							<>
								<Show when={i() > 0}>
									<span style={{ fg: colors().textMuted }}> - </span>
								</Show>
								<span
									style={{
										fg:
											tab.id === props.activeTab
												? colors().primary
												: colors().textMuted,
									}}
								>
									{tab.label}
								</span>
							</>
						)}
					</For>
				</text>
			)
		}

		return (
			<text>
				<span style={{ fg: colors().textMuted }}>
					[{props.hotkey}]─{props.title}
				</span>
			</text>
		)
	}

	return (
		<BorderBox
			topLeft={renderTitle()}
			border
			borderStyle={style().panel.borderStyle}
			borderColor={props.focused ? colors().borderFocused : colors().border}
			flexGrow={1}
			height="100%"
			overflow="hidden"
			gap={0}
		>
			{props.children}
		</BorderBox>
	)
}
