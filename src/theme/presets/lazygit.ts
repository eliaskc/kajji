import type { Theme } from "../types"

export const lazygitTheme: Theme = {
	name: "lazygit",
	colors: {
		primary: "#7FD962",
		secondary: "#56b6c2",
		background: "#0a0a0a",
		backgroundSecondary: "#141414",
		backgroundElement: "#1e1e1e",

		text: "#bfbdb6",
		textMuted: "#808080",

		border: "#bfbdb6",
		borderFocused: "#7FD962",

		selectionBackground: "#323264",
		selectionText: "#eeeeee",

		success: "#7FD962",
		warning: "#e5c07b",
		error: "#e06c75",
		info: "#56b6c2",

		purple: "#c678dd",
		orange: "#d19a66",
		green: "#7FD962",

		scrollbarTrack: "#303030",
		scrollbarThumb: "#606060",
	},
	style: {
		panel: {
			borderStyle: "rounded",
		},
		statusBar: {
			separator: "•",
		},
		dialog: {
			overlayOpacity: 0,
		},
		adaptToTerminal: true,
	},
}
