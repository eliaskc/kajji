import { describe, expect, test } from "bun:test"
import {
    type CommandDefinition,
    canDispatchCommand,
    commandGroup,
    commandsForSurface,
    isCommandApplicable,
    isCommandVisible,
    resolveCommandKey,
} from "../../../src/command/policy"

function command(
    overrides: Partial<CommandDefinition> = {},
): CommandDefinition {
    return {
        id: "test",
        title: "Test",
        context: "global",
        keybind: "enter",
        visibleIn: ["palette", "statusBar"],
        execute: () => {},
        ...overrides,
    }
}

describe("command applicability", () => {
    test("global commands apply in every context", () => {
        expect(
            isCommandApplicable(command(), {
                context: "log.revisions",
                panel: "log",
            }),
        ).toBe(true)
    })

    test("parent contexts apply to descendant contexts", () => {
        expect(
            isCommandApplicable(command({ context: "log" }), {
                context: "log.revisions",
                panel: "log",
            }),
        ).toBe(true)
    })

    test("sibling contexts do not apply", () => {
        expect(
            isCommandApplicable(command({ context: "log.files" }), {
                context: "log.revisions",
                panel: "log",
            }),
        ).toBe(false)
    })

    test("panel constraints require the active panel", () => {
        expect(
            isCommandApplicable(command({ panel: "detail" }), {
                context: "global",
                panel: "log",
            }),
        ).toBe(false)
    })
})

describe("command presentation", () => {
    test("commands can appear on both surfaces", () => {
        const definition = command({ visibleIn: ["palette", "statusBar"] })
        expect(isCommandVisible(definition, "palette")).toBe(true)
        expect(isCommandVisible(definition, "statusBar")).toBe(true)
    })

    test("surface-only commands appear only on that surface", () => {
        const paletteOnly = command({ visibleIn: ["palette"] })
        const statusOnly = command({ visibleIn: ["statusBar"] })
        expect(isCommandVisible(paletteOnly, "palette")).toBe(true)
        expect(isCommandVisible(paletteOnly, "statusBar")).toBe(false)
        expect(isCommandVisible(statusOnly, "palette")).toBe(false)
        expect(isCommandVisible(statusOnly, "statusBar")).toBe(true)
    })

    test("hidden commands appear on neither surface", () => {
        const definition = command({ visibleIn: [] })
        expect(isCommandVisible(definition, "palette")).toBe(false)
        expect(isCommandVisible(definition, "statusBar")).toBe(false)
    })

    test("palette navigation commands are deduplicated by keybind", () => {
        const commands = commandsForSurface(
            [
                command({ id: "first", group: "navigation" }),
                command({ id: "second", group: "navigation" }),
            ],
            "palette",
        )
        expect(commands.map(({ id }) => id)).toEqual(["first"])
    })
})

describe("command key resolution", () => {
    const event = { keybind: "enter" }
    const matches = (keybind: string, value: typeof event) =>
        keybind === value.keybind
    const environment = {
        context: "log.revisions" as const,
        panel: "log" as const,
        dialogOpen: false,
        dialogId: undefined,
        inputMode: false,
    }

    test("exact context wins over parent and global matches", () => {
        const result = resolveCommandKey(
            [
                command({ id: "global" }),
                command({ id: "parent", context: "log" }),
                command({ id: "exact", context: "log.revisions" }),
            ],
            event,
            environment,
            matches,
        )
        expect(result?.id).toBe("exact")
    })

    test("parent context wins over a global match", () => {
        const result = resolveCommandKey(
            [
                command({ id: "global" }),
                command({ id: "parent", context: "log" }),
            ],
            event,
            environment,
            matches,
        )
        expect(result?.id).toBe("parent")
    })

    test("commands are blocked while an input is focused", () => {
        const result = resolveCommandKey(
            [command()],
            event,
            { ...environment, inputMode: true },
            matches,
        )
        expect(result).toBeUndefined()
    })

    test("application commands are blocked while a dialog is open", () => {
        const result = resolveCommandKey(
            [command({ keybind: "quit" })],
            { keybind: "quit" },
            { ...environment, dialogOpen: true },
            matches,
        )
        expect(result).toBeUndefined()
    })

    test("the command palette remains available while a dialog is open", () => {
        const result = resolveCommandKey(
            [
                command({
                    id: "palette",
                    keybind: "command_palette",
                    scope: "always",
                }),
            ],
            { keybind: "command_palette" },
            { ...environment, dialogOpen: true },
            matches,
        )
        expect(result?.id).toBe("palette")
    })

    test("only commands for the topmost dialog match", () => {
        const result = resolveCommandKey(
            [
                command({ id: "under", scope: "dialog", dialogId: "under" }),
                command({ id: "top", scope: "dialog", dialogId: "top" }),
            ],
            event,
            { ...environment, dialogOpen: true, dialogId: "top" },
            matches,
        )
        expect(result?.id).toBe("top")
    })

    test("unbound commands do not match keyboard events", () => {
        const result = resolveCommandKey(
            [command({ keybind: undefined })],
            event,
            environment,
            matches,
        )
        expect(result).toBeUndefined()
    })
})

describe("command dispatch policy", () => {
    const environment = {
        context: "log.revisions" as const,
        panel: "log" as const,
        dialogOpen: false,
        dialogId: undefined,
        inputMode: false,
    }

    test("application scope is the default", () => {
        expect(
            canDispatchCommand(command(), {
                ...environment,
                dialogOpen: true,
            }),
        ).toBe(false)
    })

    test("always scope can execute through dialogs but not focused inputs", () => {
        const definition = command({ scope: "always" })
        expect(
            canDispatchCommand(definition, {
                ...environment,
                dialogOpen: true,
            }),
        ).toBe(true)
        expect(
            canDispatchCommand(definition, {
                ...environment,
                inputMode: true,
            }),
        ).toBe(false)
    })

    test("dialog commands require their dialog to be topmost", () => {
        const definition = command({ scope: "dialog", dialogId: "picker" })
        expect(
            canDispatchCommand(definition, {
                ...environment,
                dialogOpen: true,
                dialogId: "picker",
            }),
        ).toBe(true)
        expect(
            canDispatchCommand(definition, {
                ...environment,
                dialogOpen: true,
                dialogId: "confirm",
            }),
        ).toBe(false)
        expect(canDispatchCommand(definition, environment)).toBe(false)
    })

    test("only explicitly allowed dialog commands pass focused inputs", () => {
        const blocked = command({ scope: "dialog", dialogId: "picker" })
        const navigation = command({
            scope: "dialog",
            dialogId: "picker",
            allowInInput: true,
        })
        const focused = {
            ...environment,
            dialogOpen: true,
            dialogId: "picker",
            inputMode: true,
        }
        expect(canDispatchCommand(blocked, focused)).toBe(false)
        expect(canDispatchCommand(navigation, focused)).toBe(true)
    })

    test("input navigation bindings do not claim typing keys", () => {
        const navigation = command({
            scope: "dialog",
            dialogId: "picker",
            keybind: "input_nav_down",
            allowInInput: true,
        })
        const focused = {
            ...environment,
            dialogOpen: true,
            dialogId: "picker",
            inputMode: true,
        }
        const matchesInputNavigation = (
            keybind: string,
            value: { keybind: string },
        ) => keybind === "input_nav_down" && value.keybind === "down"

        expect(
            resolveCommandKey(
                [navigation],
                { keybind: "j" },
                focused,
                matchesInputNavigation,
            ),
        ).toBeUndefined()
        expect(
            resolveCommandKey(
                [navigation],
                { keybind: "down" },
                focused,
                matchesInputNavigation,
            )?.id,
        ).toBe("test")
    })

    test("dialog surface preserves input order", () => {
        const hints = commandsForSurface(
            [
                command({ id: "last", visibleIn: ["dialog"] }),
                command({ id: "first", visibleIn: ["dialog"] }),
                command({ id: "hidden", visibleIn: [] }),
            ],
            "dialog",
        )
        expect(hints.map(({ id }) => id)).toEqual(["last", "first"])
    })

    test("groups default from context and allow explicit cross-cutting groups", () => {
        expect(commandGroup(command({ context: "log.revisions" }))).toBe(
            "revisions",
        )
        expect(commandGroup(command({ group: "repository" }))).toBe(
            "repository",
        )
    })
})
