import { RGBA } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import {
	type JSX,
	type ParentProps,
	Show,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js"
import { createSimpleContext } from "./helper"
import { useTheme } from "./theme"

interface DialogState {
	id?: string
	render: () => JSX.Element
	onClose?: () => void
}

export const { use: useDialog, provider: DialogProvider } = createSimpleContext(
	{
		name: "Dialog",
		init: () => {
			const [stack, setStack] = createSignal<DialogState[]>([])

			const close = () => {
				const current = stack().at(-1)
				current?.onClose?.()
				setStack((s) => s.slice(0, -1))
			}

			useKeyboard((evt) => {
				if (stack().length > 0 && evt.name === "escape") {
					evt.preventDefault()
					close()
				}
			})

			const open = (
				render: () => JSX.Element,
				options?: { id?: string; onClose?: () => void },
			) => {
				setStack((s) => [
					...s,
					{ id: options?.id, render, onClose: options?.onClose },
				])
			}

			const toggle = (
				id: string,
				render: () => JSX.Element,
				options?: { onClose?: () => void },
			) => {
				const current = stack().at(-1)
				if (current?.id === id) {
					close()
				} else {
					open(render, { id, onClose: options?.onClose })
				}
			}

			return {
				isOpen: () => stack().length > 0,
				current: () => stack().at(-1),
				open,
				toggle,
				close,
				clear: () => {
					for (const item of stack()) {
						item.onClose?.()
					}
					setStack([])
				},
			}
		},
	},
)

function DialogBackdrop(props: { onClose: () => void; children: JSX.Element }) {
	const renderer = useRenderer()
	const { style } = useTheme()
	const [dimensions, setDimensions] = createSignal({
		width: renderer.width,
		height: renderer.height,
	})

	onMount(() => {
		const handleResize = (width: number, height: number) => {
			setDimensions({ width, height })
		}
		renderer.on("resize", handleResize)
		onCleanup(() => renderer.off("resize", handleResize))
	})

	const overlayColor = () =>
		RGBA.fromInts(0, 0, 0, style().dialog.overlayOpacity)

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width={dimensions().width}
			height={dimensions().height}
			backgroundColor={overlayColor()}
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
		>
			{props.children}
		</box>
	)
}

export function DialogContainer(props: ParentProps) {
	const dialog = useDialog()

	return (
		<>
			{props.children}
			<Show when={dialog.isOpen()}>
				<DialogBackdrop onClose={dialog.close}>
					{dialog.current()?.render()}
				</DialogBackdrop>
			</Show>
		</>
	)
}
