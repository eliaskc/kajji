export interface DiffThemeColors {
	additionBackground: string
	deletionBackground: string
	additionEmphasisBackground: string
	deletionEmphasisBackground: string
	additionText: string
	deletionText: string
	lineNumber: string
}

export interface ThemeColors {
	primary: string
	secondary: string
	background: string
	backgroundSecondary: string
	backgroundElement: string

	text: string
	textMuted: string

	border: string
	borderFocused: string

	selectionBackground: string
	selectionText: string

	success: string
	warning: string
	error: string
	info: string

	purple: string
	orange: string
	green: string

	titleBarFocused: string
	titleTextFocused: string
	titleTextMuted: string

	statusBarKey: string

	scrollbarTrack: string
	scrollbarThumb: string

	diff: DiffThemeColors
}

import type { SyntaxThemeName } from "./syntax"

export interface ThemeStyle {
	panel: {
		borderStyle: "rounded" | "single"
	}
	statusBar: {
		separator: string | null
	}
	dialog: {
		overlayOpacity: number
	}
	adaptToTerminal: boolean
}

export type ThemeMode = "dark" | "light"

export interface Theme {
	name: string
	colors: Record<ThemeMode, ThemeColors>
	syntax: Record<ThemeMode, SyntaxThemeName>
	style: ThemeStyle
}
