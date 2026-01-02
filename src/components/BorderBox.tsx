import type { BorderStyle } from "@opentui/core"
import type { JSX } from "solid-js"
import { Show, children as resolveChildren } from "solid-js"

type Dimension = number | "auto" | `${number}%`

interface BorderBoxProps {
	topLeft?: JSX.Element | string
	topRight?: JSX.Element | string
	bottomLeft?: JSX.Element | string
	bottomRight?: JSX.Element | string

	border?: boolean
	borderStyle?: BorderStyle
	borderColor?: string
	backgroundColor?: string
	flexGrow?: number
	flexDirection?: "row" | "column"
	width?: Dimension
	height?: Dimension
	padding?: number
	paddingLeft?: number
	paddingRight?: number
	paddingTop?: number
	paddingBottom?: number
	gap?: number
	overflow?: "hidden" | "visible"

	children: JSX.Element
}

export function BorderBox(props: BorderBoxProps) {
	const resolved = resolveChildren(() => props.children)

	const hasOverlays = () =>
		props.topLeft || props.topRight || props.bottomLeft || props.bottomRight

	const renderCorner = (
		content: JSX.Element | string | undefined,
		position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
	) => {
		if (!content) return null

		const isTop = position.startsWith("top")
		const isLeft = position.endsWith("Left")

		return (
			<box
				position="absolute"
				top={isTop ? 0 : undefined}
				bottom={!isTop ? 0 : undefined}
				left={isLeft ? 1 : undefined}
				right={!isLeft ? 1 : undefined}
				zIndex={1}
			>
				{typeof content === "string" ? <text>{content}</text> : content}
			</box>
		)
	}

	if (!hasOverlays()) {
		return (
			<box
				flexDirection={props.flexDirection ?? "column"}
				flexGrow={props.flexGrow}
				width={props.width}
				height={props.height}
				border={props.border}
				borderStyle={props.borderStyle}
				borderColor={props.borderColor}
				backgroundColor={props.backgroundColor}
				padding={props.padding}
				paddingLeft={props.paddingLeft}
				paddingRight={props.paddingRight}
				paddingTop={props.paddingTop}
				paddingBottom={props.paddingBottom}
				gap={props.gap}
				overflow={props.overflow}
			>
				{resolved()}
			</box>
		)
	}

	return (
		<box
			position="relative"
			flexDirection="column"
			flexGrow={props.flexGrow}
			width={props.width}
			height={props.height}
		>
			<Show when={props.topLeft}>{renderCorner(props.topLeft, "topLeft")}</Show>
			<Show when={props.topRight}>
				{renderCorner(props.topRight, "topRight")}
			</Show>
			<Show when={props.bottomLeft}>
				{renderCorner(props.bottomLeft, "bottomLeft")}
			</Show>
			<Show when={props.bottomRight}>
				{renderCorner(props.bottomRight, "bottomRight")}
			</Show>

			<box
				flexDirection={props.flexDirection ?? "column"}
				flexGrow={props.flexGrow}
				border={props.border}
				borderStyle={props.borderStyle}
				borderColor={props.borderColor}
				backgroundColor={props.backgroundColor}
				padding={props.padding}
				paddingLeft={props.paddingLeft}
				paddingRight={props.paddingRight}
				paddingTop={props.paddingTop}
				paddingBottom={props.paddingBottom}
				gap={props.gap}
				overflow={props.overflow}
			>
				{resolved()}
			</box>
		</box>
	)
}
