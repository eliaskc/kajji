/**
 * Panel represents the physical UI region (derived from context's first segment)
 */
export type Panel = "log" | "refs" | "detail"

/**
 * Hierarchical context representing where you are in the UI.
 * Format: panel.tab.drilldown (e.g., "log.revisions.files")
 *
 * Command matching uses prefix matching:
 * - context "log" matches "log", "log.revisions", "log.revisions.files", "log.oplog"
 * - context "log.revisions" matches "log.revisions" and "log.revisions.files"
 */
export type Context =
	// Special contexts
	| "global"
	| "help"
	// Log panel
	| "log"
	| "log.revisions"
	| "log.revisions.files"
	| "log.oplog"
	// Refs panel (bookmarks, workspaces, PRs)
	| "refs"
	| "refs.bookmarks"
	| "refs.bookmarks.revisions"
	| "refs.bookmarks.revisions.files"
	// Future: refs.workspaces, refs.prs
	// Detail panel (diff, interactive editing)
	| "detail"

export type CommandType = "action" | "navigation" | "view"

/**
 * Extract the panel from a hierarchical context
 */
export function panelFromContext(context: Context): Panel | null {
	if (context === "global" || context === "help") return null
	const panel = context.split(".")[0]
	if (panel === "log" || panel === "refs" || panel === "detail") {
		return panel
	}
	return null
}
