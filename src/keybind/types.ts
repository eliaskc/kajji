export interface KeybindInfo {
	name: string
	ctrl: boolean
	meta: boolean
	shift: boolean
}

export type KeybindConfigKey =
	| "quit"
	| "toggle_console"
	| "focus_next"
	| "focus_prev"
	| "focus_panel_1"
	| "focus_panel_2"
	| "focus_panel_3"
	| "focus_panel_4"
	| "nav_down"
	| "nav_up"
	| "nav_page_up"
	| "nav_page_down"
	| "help"
	| "refresh"
	| "enter"
	| "escape"
	| "prev_tab"
	| "next_tab"
	| "jj_new"
	| "jj_edit"
	| "jj_describe"
	| "jj_squash"
	| "jj_abandon"
	| "jj_undo"
	| "jj_redo"
	| "jj_restore"
	| "jj_rebase"
	| "jj_split"
	| "jj_git_fetch"
	| "jj_git_fetch_all"
	| "jj_git_push"
	| "jj_git_push_all"
	| "bookmark_create"
	| "bookmark_delete"
	| "bookmark_rename"
	| "bookmark_forget"
	| "bookmark_set"
	| "bookmark_move"

export type KeybindConfig = Record<KeybindConfigKey, string>

export const DEFAULT_KEYBINDS: KeybindConfig = {
	quit: "q",
	toggle_console: "§",
	focus_next: "tab",
	focus_prev: "shift+tab",
	focus_panel_1: "1",
	focus_panel_2: "2",
	focus_panel_3: "3",
	focus_panel_4: "4",
	nav_down: "j,down",
	nav_up: "k,up",
	nav_page_up: "ctrl+u",
	nav_page_down: "ctrl+d",
	help: "?",
	refresh: "ctrl+r",
	enter: "enter",
	escape: "escape",
	prev_tab: "[",
	next_tab: "]",
	jj_new: "n",
	jj_edit: "e",
	jj_describe: "d",
	jj_squash: "s",
	jj_abandon: "a",
	jj_undo: "u",
	jj_redo: "U",
	jj_restore: "r",
	jj_rebase: "r",
	jj_split: "S",
	jj_git_fetch: "f",
	jj_git_fetch_all: "F",
	jj_git_push: "p",
	jj_git_push_all: "P",
	bookmark_create: "c",
	bookmark_delete: "d",
	bookmark_rename: "r",
	bookmark_forget: "x",
	bookmark_set: "b",
	bookmark_move: "m",
}
