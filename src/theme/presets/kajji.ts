import type { Theme, ThemeColors } from "../types"

const dark: ThemeColors = {
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

	titleBarFocused: "#7FD962",
	titleTextFocused: "#0a0a0a",
	titleTextMuted: "#2a5a20",

	statusBarKey: "#7FD962",

	scrollbarTrack: "#303030",
	scrollbarThumb: "#606060",

	modes: {
		normal: { bg: "#303030", text: "#808080" },
		diff: { bg: "#56b6c2", text: "#0a0a0a" },
		log: { bg: "#e5c07b", text: "#0a0a0a" },
		pr: { bg: "#c678dd", text: "#0a0a0a" },
	},
}

const light: ThemeColors = {
	primary: "#6fcf57",
	secondary: "#5fa8b8",
	background: "#f7f7f7",
	backgroundSecondary: "#eeeeee",
	backgroundElement: "#e6e6e6",
	text: "#4f4f4f",
	textMuted: "#7a7a7a",

	border: "#dddddd",
	borderFocused: "#7FD962",

	selectionBackground: "#e4e0f2",
	selectionText: "#262631",

	success: "#62bd4a",
	warning: "#d9ae55",
	error: "#c94c57",
	info: "#5fa8b8",

	purple: "#a982bd",
	orange: "#d9ae55",
	green: "#6fcf57",

	titleBarFocused: "#7FD962",
	titleTextFocused: "#111111",
	titleTextMuted: "#3d672e",

	statusBarKey: "#62bd4a",

	scrollbarTrack: "#e3e3e3",
	scrollbarThumb: "#b8b8b8",

	modes: {
		normal: { bg: "#e6e6e6", text: "#7a7a7a" },
		diff: { bg: "#5fa8b8", text: "#111111" },
		log: { bg: "#d9ae55", text: "#111111" },
		pr: { bg: "#a982bd", text: "#111111" },
	},
}

export const kajjiTheme: Theme = {
	name: "kajji",
	colors: {
		dark,
		light,
	},
	style: {
		panel: {
			borderStyle: "rounded",
		},
		statusBar: {
			separator: "•",
		},
		dialog: {
			overlayOpacity: 150,
		},
		adaptToTerminal: true,
	},
}
