import type { ThemeMode } from "./types"

export const syntaxThemeNames = ["ayu-dark", "github-light"] as const
export type SyntaxThemeName = (typeof syntaxThemeNames)[number]

export type SyntaxThemeConfig = Partial<Record<ThemeMode, SyntaxThemeName>>
