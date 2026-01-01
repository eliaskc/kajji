export type PanelFocus = "log" | "bookmarks" | "diff"

export type CommandContext =
	| "global"
	| "commits"
	| "bookmarks"
	| "files"
	| "diff"
	| "help"

export type CommandType = "action" | "navigation" | "view"
