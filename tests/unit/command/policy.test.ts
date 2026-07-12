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

    test("groups default from context and allow explicit cross-cutting groups", () => {
        expect(commandGroup(command({ context: "log.revisions" }))).toBe(
            "revisions",
        )
        expect(commandGroup(command({ group: "repository" }))).toBe(
            "repository",
        )
    })
})
