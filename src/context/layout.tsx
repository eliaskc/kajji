import { useRenderer } from "@opentui/solid"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useFocus } from "./focus"
import { createSimpleContext } from "./helper"

const HELP_MODAL_1_COL_THRESHOLD = 90
const HELP_MODAL_2_COL_THRESHOLD = 130

export type FocusMode = "normal" | "focus"

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext(
	{
		name: "Layout",
		init: () => {
			const renderer = useRenderer()
			const focus = useFocus()

			const [terminalWidth, setTerminalWidth] = createSignal(renderer.width)
			const [terminalHeight, setTerminalHeight] = createSignal(renderer.height)

			const [focusMode, setFocusMode] = createSignal<FocusMode>("normal")

			const toggleFocusMode = () => {
				setFocusMode(focusMode() === "normal" ? "focus" : "normal")
			}

			onMount(() => {
				const handleResize = (width: number, height: number) => {
					setTerminalWidth(width)
					setTerminalHeight(height)
				}
				renderer.on("resize", handleResize)
				onCleanup(() => renderer.off("resize", handleResize))
			})

			const helpModalColumns = createMemo(() => {
				const width = terminalWidth()
				if (width < HELP_MODAL_1_COL_THRESHOLD) return 1
				if (width < HELP_MODAL_2_COL_THRESHOLD) return 2
				return 3
			})

			// Main area width for diff panel calculations.
			// In focus mode, the selected panel gets the wide side of the layout.
			const mainAreaWidth = createMemo(() => {
				const width = terminalWidth()
				const isFocusMode = focusMode() === "focus"
				const activePanel = focus.panel()
				const ratio =
					isFocusMode && (activePanel === "detail" || activePanel === "commandlog")
						? 7 / 10
						: isFocusMode && (activePanel === "log" || activePanel === "refs")
							? 4 / 10
							: 1 / 2
				const borderWidth = 2
				return Math.floor(width * ratio) - borderWidth
			})

			return {
				terminalWidth,
				terminalHeight,
				mainAreaWidth,
				helpModalColumns,
				focusMode,
				setFocusMode,
				toggleFocusMode,
			}
		},
	},
)
