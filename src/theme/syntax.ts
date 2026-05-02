import type { ThemeMode } from "./types"

export const syntaxThemeNames = ["ayu-dark", "github-light"] as const
export type SyntaxThemeName = (typeof syntaxThemeNames)[number]

export type SyntaxThemeConfig = Partial<Record<ThemeMode, SyntaxThemeName>>

export function isSyntaxThemeName(value: unknown): value is SyntaxThemeName {
	return (
		typeof value === "string" &&
		(syntaxThemeNames as readonly string[]).includes(value)
	)
}
