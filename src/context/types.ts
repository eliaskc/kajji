export type PanelFocus = "log" | "bookmarks" | "diff"

export type CommandContext =
	| "global"
	| "commits"
	| "bookmarks"
	| "files"
	| "diff"
	| "help"
	| "oplog"

export type CommandType = "action" | "navigation" | "view"
