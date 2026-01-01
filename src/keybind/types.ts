export interface KeybindInfo {
	name: string
	ctrl: boolean
	meta: boolean
	shift: boolean
}

export type KeybindConfigKey =
	| "quit"
	| "toggle_console"
	| "toggle_focus"
	| "focus_next"
	| "focus_prev"
	| "focus_panel_1"
	| "focus_panel_2"
	| "focus_panel_3"
	| "nav_down"
	| "nav_up"
	| "nav_first"
	| "nav_last"
	| "nav_page_up"
	| "nav_page_down"
	| "help"
	| "refresh"
	| "enter"
	| "escape"
	| "jj_new"
	| "jj_edit"
	| "jj_describe"
	| "jj_squash"
	| "jj_abandon"

export type KeybindConfig = Record<KeybindConfigKey, string>

export const DEFAULT_KEYBINDS: KeybindConfig = {
	quit: "q",
	toggle_console: "§",
	toggle_focus: "tab,shift+tab", // deprecated: use focus_next/focus_prev
	focus_next: "tab",
	focus_prev: "shift+tab",
	focus_panel_1: "1",
	focus_panel_2: "2",
	focus_panel_3: "3",
	nav_down: "j,down",
	nav_up: "k,up",
	nav_first: "g",
	nav_last: "G",
	nav_page_up: "ctrl+u",
	nav_page_down: "ctrl+d",
	help: "?",
	refresh: "R",
	enter: "enter",
	escape: "escape",
	jj_new: "n",
	jj_edit: "e",
	jj_describe: "d",
	jj_squash: "s",
	jj_abandon: "a",
}
