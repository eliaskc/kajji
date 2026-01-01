import { useRenderer } from "@opentui/solid"
import { type Accessor, createSignal, onMount } from "solid-js"
import { lazygitTheme } from "../theme/presets/lazygit"
import { opencodeTheme } from "../theme/presets/opencode"
import type { Theme, ThemeColors, ThemeStyle } from "../theme/types"
import { createSimpleContext } from "./helper"

const ACTIVE_THEME: "lazygit" | "opencode" = "lazygit"

const themes = {
	lazygit: lazygitTheme,
	opencode: opencodeTheme,
}

function parseHexColor(
	hex: string,
): { r: number; g: number; b: number } | null {
	if (!hex || !hex.startsWith("#") || hex.length !== 7) return null
	const r = Number.parseInt(hex.slice(1, 3), 16)
	const g = Number.parseInt(hex.slice(3, 5), 16)
	const b = Number.parseInt(hex.slice(5, 7), 16)
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
	return { r, g, b }
}

function calculateLuminance(r: number, g: number, b: number): number {
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function adjustBrightness(hex: string, amount: number): string {
	const rgb = parseHexColor(hex)
	if (!rgb) return hex
	const adjust = (c: number) => Math.max(0, Math.min(255, c + amount))
	const toHex = (c: number) => adjust(c).toString(16).padStart(2, "0")
	return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
	name: "Theme",
	init: () => {
		const renderer = useRenderer()
		const [theme, setTheme] = createSignal<Theme>(themes[ACTIVE_THEME])
		const [terminalBg, setTerminalBg] = createSignal<string | null>(null)
		const [isDark, setIsDark] = createSignal(true)

		onMount(async () => {
			try {
				const palette = await renderer.getPalette({ timeout: 1000 })
				if (palette.defaultBackground) {
					setTerminalBg(palette.defaultBackground)
					const rgb = parseHexColor(palette.defaultBackground)
					if (rgb) {
						const luminance = calculateLuminance(rgb.r, rgb.g, rgb.b)
						setIsDark(luminance <= 0.5)
					}
				}
			} catch {}
		})

		const colors: Accessor<ThemeColors> = () => {
			const base = theme().colors
			const bg = terminalBg()

			if (!theme().style.adaptToTerminal || !bg) {
				return base
			}

			const brightnessDir = isDark() ? 1 : -1
			return {
				...base,
				background: bg,
				backgroundSecondary: adjustBrightness(bg, 10 * brightnessDir),
				backgroundElement: adjustBrightness(bg, 20 * brightnessDir),
			}
		}

		const style: Accessor<ThemeStyle> = () => theme().style

		const setThemeByName = (name: "lazygit" | "opencode") => {
			setTheme(themes[name])
		}

		return {
			theme,
			colors,
			style,
			setTheme: setThemeByName,
		}
	},
})
