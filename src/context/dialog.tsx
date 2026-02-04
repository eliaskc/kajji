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
import { BorderBox } from "../components/BorderBox"
import { FooterHints } from "../components/FooterHints"
import { createSimpleContext } from "./helper"
import { useTheme } from "./theme"

export interface DialogHint {
	key: string
	label: string
}

interface DialogState {
	id?: string
	render: () => JSX.Element
	onClose?: () => void
	hints?: DialogHint[]
	title?: string
}

interface ConfirmOptions {
	message: string
}

function ConfirmDialogContent(props: {
	message: string
	onResolve: (confirmed: boolean) => void
}) {
	const { colors, style } = useTheme()

	useKeyboard((evt) => {
		if (evt.name === "y" || evt.name === "return") {
			evt.preventDefault()
			evt.stopPropagation()
			props.onResolve(true)
		} else if (evt.name === "n" || evt.name === "escape") {
			evt.preventDefault()
			evt.stopPropagation()
			props.onResolve(false)
		}
	})

	return (
		<BorderBox
			border
			borderStyle={style().panel.borderStyle}
			borderColor={colors().borderFocused}
			backgroundColor={colors().background}
			paddingLeft={2}
			width="50%"
		>
			<text fg={colors().text}>{props.message}</text>
		</BorderBox>
	)
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
					evt.stopPropagation()
					close()
				}
			})

			const open = (
				render: () => JSX.Element,
				options?: {
					id?: string
					onClose?: () => void
					hints?: DialogHint[]
					title?: string
				},
			) => {
				setStack((s) => [
					...s,
					{
						id: options?.id,
						render,
						onClose: options?.onClose,
						hints: options?.hints,
						title: options?.title,
					},
				])
			}

			const toggle = (
				id: string,
				render: () => JSX.Element,
				options?: {
					onClose?: () => void
					hints?: DialogHint[]
					title?: string
				},
			) => {
				const current = stack().at(-1)
				if (current?.id === id) {
					close()
				} else {
					open(render, {
						id,
						onClose: options?.onClose,
						hints: options?.hints,
						title: options?.title,
					})
				}
			}

			const confirm = (options: ConfirmOptions): Promise<boolean> => {
				return new Promise((resolve) => {
					let resolved = false
					const handleResolve = (confirmed: boolean) => {
						if (resolved) return
						resolved = true
						close()
						resolve(confirmed)
					}
					open(
						() => (
							<ConfirmDialogContent
								message={options.message}
								onResolve={handleResolve}
							/>
						),
						{
							id: "confirm-dialog",
							hints: [
								{ key: "y", label: "confirm" },
								{ key: "n", label: "cancel" },
							],
							onClose: () => {
								if (!resolved) {
									resolved = true
									resolve(false)
								}
							},
						},
					)
				})
			}

			return {
				isOpen: () => stack().length > 0,
				current: () => stack().at(-1),
				hints: () => stack().at(-1)?.hints ?? [],
				title: () => stack().at(-1)?.title,
				setHints: (hints: DialogHint[]) => {
					setStack((s) => {
						if (s.length === 0) return s
						const last = s[s.length - 1]
						if (!last) return s
						return [...s.slice(0, -1), { ...last, hints }]
					})
				},
				open,
				toggle,
				close,
				confirm,
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
	const { colors, style } = useTheme()
	const dialog = useDialog()
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
	const overlayWidth = () =>
		dimensions().width - (style().adaptToTerminal ? 0 : 2)
	const overlayHeight = () => Math.max(0, dimensions().height)

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width={dimensions().width}
			height={overlayHeight()}
			backgroundColor={overlayColor()}
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
		>
			<box
				flexDirection="column"
				alignItems="center"
				width={overlayWidth()}
				gap={1}
			>
				{props.children}
				<FooterHints hints={dialog.hints()} boxed title={dialog.title()} />
			</box>
		</box>
	)
}

export function DialogContainer(props: ParentProps) {
	const dialog = useDialog()

	return (
		<box flexGrow={1} width="100%" height="100%">
			{props.children}
			<Show when={dialog.isOpen()}>
				<DialogBackdrop onClose={dialog.close}>
					{dialog.current()?.render()}
				</DialogBackdrop>
			</Show>
		</box>
	)
}
