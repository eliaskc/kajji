import { CliRenderEvents } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"
import { readConfig } from "../config"
import { type ThemeModeConfig, resolveThemeMode } from "../theme/mode"
import { kajjiTheme } from "../theme/presets/kajji"
import type { SyntaxThemeName } from "../theme/syntax"
import type { Theme, ThemeColors, ThemeMode, ThemeStyle } from "../theme/types"
import {
	cacheTerminalBackground,
	getCachedTerminalBackground,
} from "../utils/state"
import { createSimpleContext } from "./helper"

const themes = {
	kajji: kajjiTheme,
}

type ThemeName = keyof typeof themes

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

function normalizeThemeName(name: string): ThemeName {
	if (name === "lazygit" || name === "opencode") return "kajji"
	return name in themes ? (name as ThemeName) : "kajji"
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
	name: "Theme",
	init: () => {
		const renderer = useRenderer()
		const config = readConfig().ui
		const [theme, setTheme] = createSignal<Theme>(
			themes[normalizeThemeName(config.theme)],
		)
		const [themeModeConfig, setThemeModeConfig] = createSignal<ThemeModeConfig>(
			config.themeMode,
		)
		const [systemMode, setSystemMode] = createSignal<ThemeMode | null>(
			renderer.themeMode,
		)
		const [syntaxThemeConfig, setSyntaxThemeConfig] = createSignal(
			config.syntaxTheme,
		)
		const [terminalBg, setTerminalBg] = createSignal<string | null>(
			getCachedTerminalBackground(),
		)
		const [hasDetectedTerminalBg, setHasDetectedTerminalBg] =
			createSignal(false)

		const terminalBgIsDark = (): boolean => {
			const bg = terminalBg()
			if (!bg) return true
			const rgb = parseHexColor(bg)
			if (!rgb) return true
			return calculateLuminance(rgb.r, rgb.g, rgb.b) <= 0.5
		}

		const mode: Accessor<ThemeMode> = () =>
			resolveThemeMode({
				configured: themeModeConfig(),
				system: systemMode(),
				terminalBgIsDark: terminalBgIsDark(),
			})

		createEffect(() => {
			if (!theme().style.adaptToTerminal || hasDetectedTerminalBg()) return

			void (async () => {
				try {
					const palette = await renderer.getPalette({ timeout: 1000 })
					if (palette.defaultBackground) {
						setTerminalBg(palette.defaultBackground)
						cacheTerminalBackground(palette.defaultBackground)
					}
				} catch {
				} finally {
					setHasDetectedTerminalBg(true)
				}
			})()
		})

		const colors: Accessor<ThemeColors> = () => {
			const base = theme().colors[mode()]
			const bg = terminalBg()

			if (!theme().style.adaptToTerminal || !bg) {
				return base
			}

			const brightnessDir = mode() === "dark" ? 1 : -1
			return {
				...base,
				background: bg,
				backgroundSecondary: adjustBrightness(bg, 10 * brightnessDir),
				backgroundElement: adjustBrightness(bg, 20 * brightnessDir),
			}
		}

		createEffect(() => {
			renderer.setBackgroundColor(colors().background)
		})

		const handleThemeMode = (nextMode: ThemeMode) => {
			setSystemMode(nextMode)
			renderer.clearPaletteCache()
			setHasDetectedTerminalBg(false)
		}

		renderer.on(CliRenderEvents.THEME_MODE, handleThemeMode)

		onCleanup(() => {
			renderer.off(CliRenderEvents.THEME_MODE, handleThemeMode)
		})

		const syntaxTheme: Accessor<SyntaxThemeName> = () =>
			syntaxThemeConfig()[mode()] ?? theme().syntax[mode()]

		const style: Accessor<ThemeStyle> = () => theme().style

		const setThemeByName = (name: string) => {
			setTheme(themes[normalizeThemeName(name)])
		}

		const setThemeMode = (nextMode: ThemeModeConfig) => {
			setThemeModeConfig(nextMode)
		}

		const setSyntaxTheme = (nextSyntaxTheme: typeof config.syntaxTheme) => {
			setSyntaxThemeConfig(nextSyntaxTheme)
		}

		return {
			theme,
			colors,
			style,
			mode,
			syntaxTheme,
			setTheme: setThemeByName,
			setThemeMode,
			setSyntaxTheme,
		}
	},
})
