import { For, type JSX, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { BorderBox } from "./BorderBox"

interface Tab {
	id: string
	label: string
}

interface PanelProps {
	title?: string
	tabs?: Tab[]
	activeTab?: string
	hotkey: string
	focused: boolean
	children: JSX.Element
}

export function Panel(props: PanelProps) {
	const { colors, style } = useTheme()

	const hasTabs = () => props.tabs && props.tabs.length > 0

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
