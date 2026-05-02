import type { ThemeMode } from "./types"

export type ThemeModeConfig = ThemeMode | "system"

export function resolveThemeMode({
	configured,
	system,
	terminalBgIsDark,
}: {
	configured: ThemeModeConfig
	system: ThemeMode | null
	terminalBgIsDark: boolean
}): ThemeMode {
	if (configured !== "system") return configured
	if (system) return system
	return terminalBgIsDark ? "dark" : "light"
}
