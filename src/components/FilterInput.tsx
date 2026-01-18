import { RGBA, type TextareaRenderable } from "@opentui/core"
import { Show } from "solid-js"
import { useTheme } from "../context/theme"

export interface FilterInputProps {
	ref?: (r: TextareaRenderable) => void
	onInput: (value: string) => void
	placeholder?: string
	dividerPosition?: "above" | "below"
	initialValue?: string
}

export function FilterInput(props: FilterInputProps) {
	const { colors } = useTheme()

	let inputRef: TextareaRenderable | undefined

	const divider = () => (
		<box height={1} overflow="hidden">
			<text fg={colors().textMuted} wrapMode="none">
				{"─".repeat(200)}
			</text>
		</box>
	)

	return (
		<>
			<Show when={props.dividerPosition === "above"}>{divider()}</Show>
			<box paddingLeft={1} paddingRight={1} height={1}>
				<text fg={colors().textMuted}>/</text>
				<textarea
					ref={(r) => {
						inputRef = r
						props.ref?.(r)
					}}
					initialValue={props.initialValue ?? ""}
					placeholder={props.placeholder ?? "Filter"}
					onContentChange={() => {
						if (inputRef) {
							props.onInput(inputRef.plainText)
						}
					}}
					wrapMode="none"
					scrollMargin={0}
					height={1}
					cursorColor={colors().primary}
					textColor={colors().text}
					focusedTextColor={colors().text}
					focusedBackgroundColor={RGBA.fromInts(0, 0, 0, 0)}
					flexGrow={1}
				/>
			</box>
			<Show when={props.dividerPosition === "below"}>{divider()}</Show>
		</>
	)
}
