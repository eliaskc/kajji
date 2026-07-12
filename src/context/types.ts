/**
 * Panel represents the physical UI region (derived from context's first segment)
 */
export type Panel = "log" | "refs" | "detail" | "commandlog"

/**
 * Context represents the current interaction mode (what keys mean right now).
 * Format: panel.mode (e.g., "log.revisions", "log.files")
 *
 * Most modes are siblings (e.g. "log.revisions" and "log.files").
 * Some contexts intentionally use sub-modes for scoped commands (e.g. "detail.diff_*" ).
 */
export type Context =
    // Special contexts
    | "global"
    | "commandPalette"
    // Log panel modes
    | "log"
    | "log.revisions"
    | "log.files"
    | "log.oplog"
    // Refs panel modes
    | "refs"
    | "refs.bookmarks"
    // Detail panel
    | "detail"
    | "detail.diff_custom"
    | "detail.diff_jj_formatter"
    // Command log panel
    | "commandlog"

/**
 * Extract the panel from a hierarchical context
 */
export function panelFromContext(context: Context): Panel | null {
    if (context === "global" || context === "commandPalette") return null
    const panel = context.split(".")[0]
    if (
        panel === "log" ||
        panel === "refs" ||
        panel === "detail" ||
        panel === "commandlog"
    ) {
        return panel as Panel
    }
    return null
}
