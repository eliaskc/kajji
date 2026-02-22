import { TextAttributes } from "@opentui/core"
import { RGBA } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import {
	For,
	type JSX,
	type ParentProps,
	Show,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js"
import { createSimpleContext } from "./helper"
import { useTheme } from "./theme"

export interface DialogHint {
	key: string
	label: string
}

type Dimension = number | "auto" | `${number}%`

export interface DialogSize {
	width?: Dimension
	maxWidth?: number
}

export const DIALOG_SIZE = {
	confirm: { width: "90%" as Dimension, maxWidth: 48 } satisfies DialogSize,
	confirmWide: { width: "90%" as Dimension, maxWidth: 64 } satisfies DialogSize,
	confirmExtraWide: {
		width: "90%" as Dimension,
		maxWidth: 80,
	} satisfies DialogSize,
	form: { width: "90%" as Dimension, maxWidth: 90 } satisfies DialogSize,
	describe: { width: "90%" as Dimension, maxWidth: 64 } satisfies DialogSize,
	picker: { width: "90%" as Dimension, maxWidth: 100 } satisfies DialogSize,
} as const

type DimensionOrAccessor = Dimension | (() => Dimension)

interface DialogState {
	id?: string
	render: () => JSX.Element
	onClose?: () => void
	hints?: DialogHint[]
	title?: string | StyledSegment[]
	width?: DimensionOrAccessor
	maxWidth?: number
}

export type StyledSegment =
	| string
	| { text: string; style?: "action" | "target" | "muted" }

interface ConfirmOptions {
	message: string | StyledSegment[]
	width?: Dimension
	maxWidth?: number
}

function StyledText(props: {
	content: string | StyledSegment[]
	bold?: boolean
}) {
	const { colors } = useTheme()

	if (typeof props.content === "string") {
		return (
			<text
				fg={colors().text}
				attributes={props.bold ? TextAttributes.BOLD : undefined}
			>
				{props.content}
			</text>
		)
	}

	return (
		<text>
			<For each={props.content}>
				{(segment) => {
					if (typeof segment === "string") {
						return (
							<span
								style={{
									fg: colors().text,
									attributes: props.bold ? TextAttributes.BOLD : undefined,
								}}
							>
								{segment}
							</span>
						)
					}
					switch (segment.style) {
						case "action":
							return (
								<span
									style={{
										fg: colors().warning,
										attributes: TextAttributes.BOLD,
									}}
								>
									{segment.text}
								</span>
							)
						case "target":
							return (
								<span
									style={{
										fg: colors().primary,
										attributes: TextAttributes.BOLD,
									}}
								>
									{segment.text}
								</span>
							)
						case "muted":
							return (
								<span style={{ fg: colors().textMuted }}>{segment.text}</span>
							)
						default:
							return (
								<span
									style={{
										fg: colors().text,
										attributes: props.bold ? TextAttributes.BOLD : undefined,
									}}
								>
									{segment.text}
								</span>
							)
					}
				}}
			</For>
		</text>
	)
}

function ConfirmDialogContent(props: {
	message: string | StyledSegment[]
	onResolve: (confirmed: boolean) => void
}) {
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

	return <StyledText content={props.message} bold />
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
					title?: string | StyledSegment[]
					width?: DimensionOrAccessor
					maxWidth?: number
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
						width: options?.width,
						maxWidth: options?.maxWidth,
					},
				])
			}

			const toggle = (
				id: string,
				render: () => JSX.Element,
				options?: {
					onClose?: () => void
					hints?: DialogHint[]
					title?: string | StyledSegment[]
					width?: DimensionOrAccessor
					maxWidth?: number
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
						width: options?.width,
						maxWidth: options?.maxWidth,
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
							width: options.width,
							maxWidth: options.maxWidth,
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

			const resolveWidth = (
				w: DimensionOrAccessor | undefined,
			): Dimension | undefined => (typeof w === "function" ? w() : w)

			return {
				isOpen: () => stack().length > 0,
				current: () => stack().at(-1),
				hints: () => stack().at(-1)?.hints ?? [],
				title: () => stack().at(-1)?.title,
				width: () => stack().at(-1)?.width,
				resolvedWidth: () => resolveWidth(stack().at(-1)?.width) ?? "50%",
				maxWidth: () => stack().at(-1)?.maxWidth,
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

function DialogHints(props: { hints: DialogHint[] }) {
	const { colors, style } = useTheme()
	const separator = () => style().statusBar.separator
	const hintGap = () => (separator() ? ` ${separator()} ` : "   ")

	return (
		<Show when={props.hints.length > 0}>
			<box width="100%" alignItems="center">
				<text wrapMode="none">
					<For each={props.hints}>
						{(hint, index) => (
							<>
								<span style={{ fg: colors().primary }}>{hint.key}</span>{" "}
								<span style={{ fg: colors().textMuted }}>{hint.label}</span>
								<Show when={index() < props.hints.length - 1}>
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
			</box>
		</Show>
	)
}

function DialogBackdrop(props: { children: JSX.Element }) {
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
				width={dialog.resolvedWidth()}
				maxWidth={dialog.maxWidth()}
				backgroundColor={colors().background}
				paddingLeft={2}
				paddingRight={2}
				paddingTop={1}
				paddingBottom={1}
				gap={1}
			>
				<Show when={dialog.title()}>
					{(title: () => string | StyledSegment[]) => (
						<StyledText content={title()} bold />
					)}
				</Show>
				{props.children}
				<DialogHints hints={dialog.hints()} />
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
				<DialogBackdrop>{dialog.current()?.render()}</DialogBackdrop>
			</Show>
		</box>
	)
}
