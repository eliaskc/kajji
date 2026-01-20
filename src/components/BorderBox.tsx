import type { BorderStyle } from "@opentui/core"
import type { JSX } from "solid-js"
import { Show, children as resolveChildren } from "solid-js"

type Dimension = number | "auto" | `${number}%`
type CornerContent = JSX.Element | string | (() => JSX.Element | string)

interface BorderBoxProps {
	topLeft?: CornerContent
	topRight?: CornerContent
	bottomLeft?: CornerContent
	bottomRight?: CornerContent

	border?: boolean
	borderStyle?: BorderStyle
	borderColor?: string
	backgroundColor?: string
	flexGrow?: number
	flexDirection?: "row" | "column"
	width?: Dimension
	maxWidth?: Dimension
	height?: Dimension
	padding?: number
	paddingLeft?: number
	paddingRight?: number
	paddingTop?: number
	paddingBottom?: number
	gap?: number
	overflow?: "hidden" | "visible"
	onMouseDown?: () => void

	children: JSX.Element
}

export function BorderBox(props: BorderBoxProps) {
	const resolved = resolveChildren(() => props.children)

	const hasOverlays = () =>
		props.topLeft || props.topRight || props.bottomLeft || props.bottomRight

	const resolveCorner = (content: CornerContent | undefined) =>
		typeof content === "function" ? content() : content

	const renderCorner = (
		position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
	) => {
		const content = resolveCorner(props[position])
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
			maxWidth={props.maxWidth}
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
				onMouseDown={props.onMouseDown}
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
			maxWidth={props.maxWidth}
			height={props.height}
			onMouseDown={props.onMouseDown}
		>
			<Show when={props.topLeft}>{() => renderCorner("topLeft")}</Show>
			<Show when={props.topRight}>{() => renderCorner("topRight")}</Show>
			<Show when={props.bottomLeft}>{() => renderCorner("bottomLeft")}</Show>
			<Show when={props.bottomRight}>{() => renderCorner("bottomRight")}</Show>

			<box
			flexDirection={props.flexDirection ?? "column"}
			flexGrow={1}
			maxWidth={props.maxWidth}
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
