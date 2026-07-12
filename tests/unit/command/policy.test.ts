import { describe, expect, test } from "bun:test"
import {
    type CommandDefinition,
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
        type: "action",
        keybind: "enter",
        onSelect: () => {},
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
    test("all commands appear on both surfaces", () => {
        const definition = command({ visibility: "all" })
        expect(isCommandVisible(definition, "palette")).toBe(true)
        expect(isCommandVisible(definition, "statusBar")).toBe(true)
    })

    test("omitted visibility defaults to both surfaces", () => {
        const definition = command()
        expect(isCommandVisible(definition, "palette")).toBe(true)
        expect(isCommandVisible(definition, "statusBar")).toBe(true)
    })

    test("surface-only commands appear only on that surface", () => {
        const paletteOnly = command({ visibility: "help-only" })
        const statusOnly = command({ visibility: "status-only" })
        expect(isCommandVisible(paletteOnly, "palette")).toBe(true)
        expect(isCommandVisible(paletteOnly, "statusBar")).toBe(false)
        expect(isCommandVisible(statusOnly, "palette")).toBe(false)
        expect(isCommandVisible(statusOnly, "statusBar")).toBe(true)
    })

    test("hidden commands appear on neither surface", () => {
        const definition = command({ visibility: "none" })
        expect(isCommandVisible(definition, "palette")).toBe(false)
        expect(isCommandVisible(definition, "statusBar")).toBe(false)
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
            [command({ id: "palette", keybind: "help" })],
            { keybind: "help" },
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
