import { useRenderer } from "@opentui/solid"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"

const HELP_MODAL_1_COL_THRESHOLD = 90
const HELP_MODAL_2_COL_THRESHOLD = 130

export type LayoutMode = "normal" | "diff"

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext(
    {
        name: "Layout",
        init: () => {
            const renderer = useRenderer()
            const [terminalWidth, setTerminalWidth] = createSignal(
                renderer.width,
            )
            const [terminalHeight, setTerminalHeight] = createSignal(
                renderer.height,
            )

            const [layoutMode, setLayoutMode] =
                createSignal<LayoutMode>("normal")

            onMount(() => {
                const handleResize = (width: number, height: number) => {
                    setTerminalWidth(width)
                    setTerminalHeight(height)
                }
                renderer.on("resize", handleResize)
                onCleanup(() => renderer.off("resize", handleResize))
            })

            const commandPaletteColumns = createMemo(() => {
                const width = terminalWidth()
                if (width < HELP_MODAL_1_COL_THRESHOLD) return 1
                if (width < HELP_MODAL_2_COL_THRESHOLD) return 2
                return 3
            })

            const mainAreaWidth = createMemo(() => {
                const width = terminalWidth()
                const borderWidth = 2
                return Math.floor(width / 2) - borderWidth
            })

            return {
                terminalWidth,
                terminalHeight,
                mainAreaWidth,
                commandPaletteColumns,
                layoutMode,
                setLayoutMode,
            }
        },
    },
)
