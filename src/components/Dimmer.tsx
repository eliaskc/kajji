import { RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { useTheme } from "../context/theme"

interface DimmerProps {
	dimmed: boolean
	grow?: boolean
	children: JSX.Element
}

export function Dimmer(props: DimmerProps) {
	const { style } = useTheme()

	const overlayOpacity = () => Math.round(style().dialog.overlayOpacity * 0.6)
	const overlayColor = () => RGBA.fromInts(0, 0, 0, overlayOpacity())

	return (
		<box
			position="relative"
			flexGrow={props.grow ? 1 : undefined}
			flexBasis={props.grow ? 0 : undefined}
		>
			{props.children}
			<Show when={props.dimmed}>
				<box
					position="absolute"
					left={0}
					top={0}
					width="100%"
					height="100%"
					backgroundColor={overlayColor()}
					zIndex={1}
				/>
			</Show>
		</box>
	)
}
