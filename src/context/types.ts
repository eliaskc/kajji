/**
 * Panel represents the physical UI region (derived from context's first segment)
 */
export type Panel = "log" | "refs" | "detail"

/**
 * Context represents the current interaction mode (what keys mean right now).
 * Format: panel.mode (e.g., "log.revisions", "log.files")
 *
 * Modes are siblings, not hierarchical. "files" is NOT a child of "revisions".
 * This prevents accidental command inheritance via prefix matching.
 */
export type Context =
	// Special contexts
	| "global"
	| "help"
	// Log panel modes
	| "log"
	| "log.revisions"
	| "log.files"
	| "log.oplog"
	// Refs panel modes
	| "refs"
	| "refs.bookmarks"
	| "refs.revisions"
	| "refs.files"
	// Detail panel
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
