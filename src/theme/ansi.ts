import type { ThemeMode } from "./types"

function normalizeHex(hex: string): string {
	return hex.toLowerCase()
}

export function resolveAnsiForeground({
	fg,
	mode,
	text,
	textMuted,
	defaultFg,
}: {
	fg: string | null | undefined
	mode: ThemeMode
	text: string
	textMuted: string
	defaultFg?: string
}): string {
	if (!fg) return defaultFg ?? text
	if (mode !== "light") return fg

	switch (normalizeHex(fg)) {
		case "#ffffff":
		case "#eeeeee":
		case "#eaeaea":
		case "#c5c8c6":
			return defaultFg ?? text
		case "#666666":
		case "#808080":
			return textMuted
		default:
			return fg
	}
}
