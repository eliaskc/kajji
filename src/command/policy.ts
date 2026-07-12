import type { Context, Panel } from "../context/types"
import type { KeybindConfigKey } from "../keybind"

export type CommandSurface = "palette" | "statusBar"
export type CommandScope = "application" | "always"
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
    execute: () => void
}

export interface CommandEnvironment {
    context: Context
    panel: Panel | null
    dialogOpen: boolean
    inputMode: boolean
}

export function contextMatches(
    commandContext: Context,
    activeContext: Context,
): boolean {
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
    environment: Pick<CommandEnvironment, "context" | "panel">,
): boolean {
    if (!contextMatches(command.context, environment.context)) return false
    if (command.panel && command.panel !== environment.panel) return false
    return true
}

export function isCommandVisible(
    command: CommandDefinition,
    surface: CommandSurface,
): boolean {
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
    const visible = commands.filter((command) =>
        isCommandVisible(command, surface),
    )
    if (surface !== "palette") return visible

    const navigationKeybinds = new Set<KeybindConfigKey>()
    return visible.filter((command) => {
        if (commandGroup(command) !== "navigation" || !command.keybind)
            return true
        if (navigationKeybinds.has(command.keybind)) return false
        navigationKeybinds.add(command.keybind)
        return true
    })
}

export function canDispatchCommand(
    command: CommandDefinition,
    environment: CommandEnvironment,
): boolean {
    if (environment.inputMode) return false
    if (environment.dialogOpen && command.scope !== "always") return false
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
        if (!command.keybind || !matchesKeybind(command.keybind, event))
            continue

        const specificity = contextSpecificity(
            command.context,
            environment.context,
        )
        if (specificity > highestSpecificity) {
            match = command
            highestSpecificity = specificity
        }
    }

    return match
}
