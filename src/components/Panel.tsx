import { For, type JSX, Show } from "solid-js"
import { useCommand } from "../context/command"
import { useFocus } from "../context/focus"
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
	const focus = useFocus()

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
				title: "next tab",
				keybind: "next_tab",
				context: props.panelId,
				type: "navigation",
				panel: props.panelId,
				visibility: "help-only" as const,
				onSelect: () => cycleTab(1),
			},
			{
				id: `${props.panelId}.prev_tab`,
				title: "previous tab",
				keybind: "prev_tab",
				context: props.panelId,
				type: "navigation",
				panel: props.panelId,
				visibility: "help-only" as const,
				onSelect: () => cycleTab(-1),
			},
		]
	})

	const renderTitle = () => {
		if (hasTabs()) {
			return (
				<text>
					<Show
						when={props.focused}
						fallback={
							<span style={{ fg: colors().border }}>[{props.hotkey}]</span>
						}
					>
						<span style={{ fg: colors().borderFocused }}>[{props.hotkey}]</span>
					</Show>
					<span style={{ fg: colors().border }}>─</span>
					<For each={props.tabs}>
						{(tab, i) => (
							<>
								<Show when={i() > 0}>
									<span style={{ fg: colors().border }}> </span>
								</Show>
								<span
									style={{
										fg:
											tab.id === props.activeTab
												? colors().borderFocused
												: colors().border,
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
				<Show
					when={props.focused}
					fallback={
						<span style={{ fg: colors().border }}>
							[{props.hotkey}]─{props.title}
						</span>
					}
				>
					<span style={{ fg: colors().borderFocused }}>
						[{props.hotkey}]─{props.title}
					</span>
				</Show>
			</text>
		)
	}

	const handleMouseDown = () => {
		if (props.panelId) {
			focus.setPanel(props.panelId)
		}
	}

	return (
		<BorderBox
			topLeft={renderTitle}
			border
			borderStyle={style().panel.borderStyle}
			borderColor={props.focused ? colors().borderFocused : colors().border}
			flexGrow={1}
			height="100%"
			overflow="hidden"
			gap={0}
			onMouseDown={handleMouseDown}
		>
			{props.children}
		</BorderBox>
	)
}
