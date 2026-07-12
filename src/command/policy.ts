import type {
    CommandType,
    CommandVisibility,
    Context,
    Panel,
} from "../context/types"
import type { KeybindConfigKey } from "../keybind"

export type CommandSurface = "palette" | "statusBar"

export interface CommandDefinition {
    id: string
    title: string
    keybind?: KeybindConfigKey
    context: Context
    type: CommandType
    panel?: Panel
    visibility?: CommandVisibility
    onSelect: () => void
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
    const visibility = command.visibility ?? "all"
    if (visibility === "none") return false
    if (visibility === "all") return true
    if (surface === "palette") return visibility === "help-only"
    return visibility === "status-only"
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
        if (environment.dialogOpen && command.keybind !== "help") continue
        if (environment.inputMode) continue
        if (
            !environment.dialogOpen &&
            !isCommandApplicable(command, environment)
        ) {
            continue
        }
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
