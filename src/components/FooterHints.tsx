import { For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { BorderBox } from "./BorderBox"

export interface FooterHint {
	key: string
	label: string
}

interface FooterHintsProps {
	hints: FooterHint[]
	boxed?: boolean
	title?: string
	borderColor?: string
}

export function FooterHints(props: FooterHintsProps) {
	const { colors, style } = useTheme()
	const separator = () => style().statusBar.separator
	const hintGap = () => (separator() ? ` ${separator()} ` : "   ")
	const rows = () => {
		const items = props.hints
		if (items.length <= 4) return [items]
		const splitAt = Math.ceil(items.length / 2)
		return [items.slice(0, splitAt), items.slice(splitAt)]
	}

	const content = () => (
		<box flexDirection="column" alignItems="center" gap={0}>
			<For each={rows()}>
				{(row) => (
					<text wrapMode="none">
						<For each={row}>
							{(hint, index) => (
								<>
									<span style={{ fg: colors().primary }}>{hint.key}</span>{" "}
									<span style={{ fg: colors().textMuted }}>{hint.label}</span>
									<Show when={index() < row.length - 1}>
										<span
											style={{
												fg: separator() ? colors().textMuted : undefined,
											}}
										>
											{hintGap()}
										</span>
									</Show>
								</>
							)}
						</For>
					</text>
				)}
			</For>
		</box>
	)

	return (
		<Show when={props.hints.length > 0}>
			<Show when={props.boxed} fallback={content()}>
				<BorderBox
					border
					borderStyle={style().panel.borderStyle}
					borderColor={props.borderColor ?? colors().borderFocused}
					backgroundColor={colors().background}
					paddingLeft={2}
					paddingRight={2}
					topLeft={
						props.title ? (
							<text fg={colors().borderFocused}>{props.title}</text>
						) : undefined
					}
				>
					{content()}
				</BorderBox>
			</Show>
		</Show>
	)
}
