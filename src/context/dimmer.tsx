import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import type { Panel } from "./types"

type DimReason = "filter-log" | "filter-bookmarks" | "filter-files" | "command"
interface DimmerOptions {
	keepVisible?: Panel[]
}

export const { use: useDimmer, provider: DimmerProvider } = createSimpleContext(
	{
		name: "Dimmer",
		init: () => {
			const [sourcePanel, setSourcePanel] = createSignal<Panel | null>(null)
			const [reason, setReason] = createSignal<DimReason | null>(null)
			const [keepVisible, setKeepVisible] = createSignal<Set<Panel>>(
				new Set<Panel>(),
			)

			const activate = (
				panel: Panel,
				nextReason: DimReason,
				options?: DimmerOptions,
			) => {
				setSourcePanel(panel)
				setReason(nextReason)
				setKeepVisible(new Set<Panel>(options?.keepVisible ?? []))
			}

			const clear = (panel?: Panel, clearReason?: DimReason) => {
				if (panel && sourcePanel() !== panel) return
				if (clearReason && reason() !== clearReason) return
				setSourcePanel(null)
				setReason(null)
				setKeepVisible(new Set<Panel>())
			}

			const isDimmed = (panel: Panel) => {
				const current = sourcePanel()
				if (!current) return false
				if (panel === current) return false
				return !keepVisible().has(panel)
			}

			return {
				activate,
				clear,
				isDimmed,
				sourcePanel,
				reason,
				keepVisible,
			}
		},
	},
)
