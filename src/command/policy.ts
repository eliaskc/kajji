import type { StyledSegment } from "../context/dialog"
import type { Context, Panel } from "../context/types"
import type { KeybindConfigKey } from "../keybind"

export type CommandSurface = "dialog" | "palette" | "statusBar"
export type CommandScope = "application" | "always" | "dialog"
export type CommandGroup =
    | "revisions"
    | "files"
    | "bookmarks"
    | "oplog"
    | "detail"
    | "repository"
    | "navigation"
    | "application"

export interface CommandDefinition {
    id: string
    title: string
    description?: string
    keybind?: KeybindConfigKey
    context: Context
    panel?: Panel
    visibleIn: readonly CommandSurface[]
    group?: CommandGroup
    scope?: CommandScope
    dialogId?: string
    allowInInput?: boolean
    hintLabel?: string
    /**
     * Reason the command cannot run right now (e.g. it needs a single
     * revision while a multi-selection is active). Unavailable commands are
     * hidden from the status bar, shown muted in the palette, and pressing
     * their keybind surfaces the reason instead of executing.
     */
    unavailable?: () => string | null
    execute: () => void
}

export interface CommandEnvironment {
    context: Context
    panel: Panel | null
    dialogOpen: boolean
    dialogId?: string
    inputMode: boolean
}

export function contextMatches(commandContext: Context, activeContext: Context): boolean {
    if (commandContext === "global") return true
    if (commandContext === activeContext) return true
    return activeContext.startsWith(`${commandContext}.`)
}

function contextSpecificity(context: Context, activeContext: Context): number {
    if (context === activeContext) return Number.MAX_SAFE_INTEGER
    if (context === "global") return 0
    return context.split(".").length
}

export function isCommandApplicable(
    command: CommandDefinition,
    environment: Pick<CommandEnvironment, "context" | "panel" | "dialogId">,
): boolean {
    if (
        command.scope === "dialog" &&
        (!command.dialogId || command.dialogId !== environment.dialogId)
    )
        return false
    if (!contextMatches(command.context, environment.context)) return false
    if (command.panel && command.panel !== environment.panel) return false
    return true
}

export function commandUnavailableReason(command: CommandDefinition): string | null {
    return command.unavailable?.() ?? null
}

// Reasons are written as predicates that read after the command title
// ("only works for a single revision"), so surfaces can lead with the
// highlighted title.
export function commandUnavailableMessage(
    command: CommandDefinition,
    reason: string,
): StyledSegment[] {
    const title =
        command.title.length > 0
            ? command.title.charAt(0).toUpperCase() + command.title.slice(1)
            : command.title
    return [{ text: title, style: "action" }, ` ${reason}`]
}

export function isCommandVisible(command: CommandDefinition, surface: CommandSurface): boolean {
    return command.visibleIn.includes(surface)
}

export function commandGroup(command: CommandDefinition): CommandGroup {
    if (command.group) return command.group
    if (command.context === "log.revisions") return "revisions"
    if (command.context === "log.files") return "files"
    if (command.context === "refs.bookmarks") return "bookmarks"
    if (command.context === "log.oplog") return "oplog"
    if (
        command.context === "detail" ||
        command.context.startsWith("detail.") ||
        command.context === "commandlog"
    )
        return "detail"
    return "application"
}

export function commandsForSurface(
    commands: readonly CommandDefinition[],
    surface: CommandSurface,
): CommandDefinition[] {
    const visible = commands.filter((command) => isCommandVisible(command, surface))
    if (surface !== "palette") return visible

    const navigationKeybinds = new Set<KeybindConfigKey>()
    return visible.filter((command) => {
        if (commandGroup(command) !== "navigation" || !command.keybind) return true
        if (navigationKeybinds.has(command.keybind)) return false
        navigationKeybinds.add(command.keybind)
        return true
    })
}

export function canDispatchCommand(
    command: CommandDefinition,
    environment: CommandEnvironment,
): boolean {
    if (environment.inputMode && !(command.scope === "dialog" && command.allowInInput)) return false
    if (command.scope === "dialog") {
        if (!environment.dialogOpen) return false
    } else if (environment.dialogOpen && command.scope !== "always") {
        return false
    }
    return isCommandApplicable(command, environment)
}

export function resolveCommandKey<Event>(
    commands: readonly CommandDefinition[],
    event: Event,
    environment: CommandEnvironment,
    matchesKeybind: (keybind: KeybindConfigKey, event: Event) => boolean,
): CommandDefinition | undefined {
    let match: CommandDefinition | undefined
    let highestSpecificity = -1

    for (const command of commands) {
        if (!canDispatchCommand(command, environment)) continue
        if (!command.keybind || !matchesKeybind(command.keybind, event)) continue

        const specificity = contextSpecificity(command.context, environment.context)
        if (specificity > highestSpecificity) {
            match = command
            highestSpecificity = specificity
        }
    }

    return match
}
