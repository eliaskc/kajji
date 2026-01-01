import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import type { CommandContext, PanelFocus } from "./types"

export type { PanelFocus }

const PANEL_ORDER: PanelFocus[] = ["log", "bookmarks", "diff"]

export const { use: useFocus, provider: FocusProvider } = createSimpleContext({
	name: "Focus",
	init: () => {
		const [panel, setPanel] = createSignal<PanelFocus>("log")
		const [activeContext, setActiveContext] =
			createSignal<CommandContext>("commits")

		const setFocusedPanel = (p: PanelFocus) => {
			setPanel(p)
		}

		const cycleNext = () => {
			const current = panel()
			const idx = PANEL_ORDER.indexOf(current)
			const next = PANEL_ORDER[(idx + 1) % PANEL_ORDER.length] ?? "log"
			setFocusedPanel(next)
		}

		const cyclePrev = () => {
			const current = panel()
			const idx = PANEL_ORDER.indexOf(current)
			const next =
				PANEL_ORDER[(idx - 1 + PANEL_ORDER.length) % PANEL_ORDER.length] ??
				"log"
			setFocusedPanel(next)
		}

		return {
			panel,
			setPanel: setFocusedPanel,
			activeContext,
			setActiveContext,
			cycleNext,
			cyclePrev,
			isPanel: (p: PanelFocus) => panel() === p,
		}
	},
})
