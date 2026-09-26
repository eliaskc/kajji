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
    /** kajji's own color: focused titles, status bar keys. */
    brand: string
    /** Secondary highlight, for example author names. */
    accent: string
    background: string
    backgroundSecondary: string
    backgroundElement: string

    text: string
    textMuted: string

    border: string

    selectionBackground: string
    selectionText: string

    success: string
    /** Warnings only. Use `highlight` for actions. */
    warning: string
    error: string
    info: string
    /** Highlights actions in status messages and dialogs. */
    highlight: string

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
