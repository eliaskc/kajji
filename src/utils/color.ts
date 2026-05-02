const HEX_COLOR_RE = /^#?([0-9a-fA-F]{6})$/

function parseHexColor(color: string) {
	const match = HEX_COLOR_RE.exec(color)
	if (!match) return null

	const hex = match[1]
	if (!hex) return null

	return {
		r: Number.parseInt(hex.slice(0, 2), 16),
		g: Number.parseInt(hex.slice(2, 4), 16),
		b: Number.parseInt(hex.slice(4, 6), 16),
	}
}

function toHex(value: number) {
	return Math.round(Math.max(0, Math.min(255, value)))
		.toString(16)
		.padStart(2, "0")
}

export function blendColors(
	foreground: string,
	background: string,
	foregroundOpacity: number,
) {
	const fg = parseHexColor(foreground)
	const bg = parseHexColor(background)
	if (!fg || !bg) return foreground

	const alpha = Math.max(0, Math.min(1, foregroundOpacity))
	const inverseAlpha = 1 - alpha

	return `#${toHex(fg.r * alpha + bg.r * inverseAlpha)}${toHex(
		fg.g * alpha + bg.g * inverseAlpha,
	)}${toHex(fg.b * alpha + bg.b * inverseAlpha)}`
}
