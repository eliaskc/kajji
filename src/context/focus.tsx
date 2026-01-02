import { createMemo, createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import { type Context, type Panel, panelFromContext } from "./types"

export type { Panel }

const PANEL_ORDER: Panel[] = ["log", "refs", "detail"]

export const { use: useFocus, provider: FocusProvider } = createSimpleContext({
	name: "Focus",
	init: () => {
		const [activeContext, setActiveContext] =
			createSignal<Context>("log.revisions")

		const panel = createMemo<Panel>(() => {
			return panelFromContext(activeContext()) ?? "log"
		})

		const setPanel = (p: Panel) => {
			const current = activeContext()
			const currentPanel = panelFromContext(current)
			if (currentPanel === p) return

			switch (p) {
				case "log":
					setActiveContext("log.revisions")
					break
				case "refs":
					setActiveContext("refs.bookmarks")
					break
				case "detail":
					setActiveContext("detail")
					break
			}
		}

		const cycleNext = () => {
			const current = panel()
			const idx = PANEL_ORDER.indexOf(current)
			const next = PANEL_ORDER[(idx + 1) % PANEL_ORDER.length] ?? "log"
			setPanel(next)
		}

		const cyclePrev = () => {
			const current = panel()
			const idx = PANEL_ORDER.indexOf(current)
			const next =
				PANEL_ORDER[(idx - 1 + PANEL_ORDER.length) % PANEL_ORDER.length] ??
				"log"
			setPanel(next)
		}

		return {
			panel,
			setPanel,
			activeContext,
			setActiveContext,
			cycleNext,
			cyclePrev,
			isPanel: (p: Panel) => panel() === p,
		}
	},
})
