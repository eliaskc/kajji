import { describe, expect, test } from "bun:test"
import type { FlattenedFile } from "../../../src/diff"
import type { StructuralFileResult } from "../../../src/diff/structural/difft-json"
import {
    type StructuralFlattenResult,
    flattenStructuralFile,
} from "../../../src/diff/structural/flatten"

function fakeTextualFile(
    name: string,
    type: string,
    additions: number,
    deletions: number,
): FlattenedFile {
    return {
        fileId: name,
        name,
        type,
        hunks: [],
        additions,
        deletions,
    } as unknown as FlattenedFile
}

function structuralFileOf(result: StructuralFlattenResult) {
    if (result.kind !== "structural") {
        throw new Error(`expected structural result, got ${result.kind}`)
    }
    return result.file
}

describe("structural flattener", () => {
    test("keeps matched syntax neutral while emphasizing structural changes", () => {
        const oldLines = [
            '            diagnosticsLog(success ? "info" : "error", "jj command finished", {',
            '                command: "jj git fetch",',
        ]
        const newLines = [
            '        diagnosticsLog(success ? "info" : "error", "jj command finished", {',
            "            command: result.command,",
        ]
        const oldChanged = oldLines[1]?.indexOf('"jj git fetch"') ?? 0
        const newChanged = newLines[1]?.indexOf("result.command") ?? 0
        const result: StructuralFileResult = {
            language: "TypeScript",
            status: "changed",
            aligned_lines: [
                [0, 0],
                [1, 1],
            ],
            chunks: [
                [
                    {
                        lhs: {
                            line_number: 1,
                            changes: [
                                {
                                    start: oldChanged,
                                    end: oldChanged + '"jj git fetch"'.length,
                                    content: '"jj git fetch"',
                                },
                            ],
                        },
                        rhs: {
                            line_number: 1,
                            changes: [
                                {
                                    start: newChanged,
                                    end: newChanged + "result.command".length,
                                    content: "result.command",
                                },
                            ],
                        },
                    },
                ],
            ],
        }
        const file = fakeTextualFile("client.ts", "change", 2, 2)

        const flattened = structuralFileOf(
            flattenStructuralFile(file, oldLines.join("\n"), newLines.join("\n"), result),
        )
        expect(flattened.structural).toBe(true)
        const lines = flattened.hunks[0]?.lines ?? []
        const diagnostics = lines.filter(
            (line) => line.oldLineNumber === 1 || line.newLineNumber === 1,
        )
        const command = lines.filter((line) => line.oldLineNumber === 2 || line.newLineNumber === 2)

        // Structurally unchanged but reindented: unified shows the new side
        // once as context.
        expect(diagnostics.map((line) => line.type)).toEqual(["context"])
        expect(diagnostics.map((line) => line.content)).toEqual([newLines[0] ?? ""])
        expect(diagnostics.every((line) => line.wordDiff === undefined)).toBe(true)
        expect(
            command
                .flatMap((line) => line.wordDiff ?? [])
                .filter((segment) => segment.type !== "unchanged")
                .map((segment) => segment.text),
        ).toEqual(['"jj git fetch"', "result.command"])

        // Split view sees both sides of the reindented pair as context.
        const alignedRows = flattened.hunks[0]?.alignedRows ?? []
        expect(alignedRows).toHaveLength(2)
        expect(alignedRows[0]?.left?.type).toBe("context")
        expect(alignedRows[0]?.left?.content).toBe(oldLines[0] ?? "")
        expect(alignedRows[0]?.right?.type).toBe("context")
        expect(alignedRows[0]?.right?.content).toBe(newLines[0] ?? "")
        expect(alignedRows[1]?.left?.type).toBe("deletion")
        expect(alignedRows[1]?.right?.type).toBe("addition")
    })

    test("does not emphasize one-sided additions", () => {
        const file = fakeTextualFile("added.ts", "change", 1, 0)
        const content = "const added = true"

        const flattened = structuralFileOf(
            flattenStructuralFile(file, "", content, {
                language: "TypeScript",
                status: "changed",
                aligned_lines: [[null, 0]],
                chunks: [
                    [
                        {
                            rhs: {
                                line_number: 0,
                                changes: [
                                    {
                                        start: 0,
                                        end: content.length,
                                        content,
                                    },
                                ],
                            },
                        },
                    ],
                ],
            }),
        )

        expect(flattened.hunks[0]?.lines[0]?.wordDiff).toBeUndefined()
        expect(flattened.hunks[0]?.alignedRows?.[0]?.left).toBeNull()
    })

    test("does not emphasize fully novel aligned lines", () => {
        const oldLines = ["", "// old comment"]
        const newLines = ["const wordDiff = props.row.wordDiff", "const emphasisType = added"]
        const file = fakeTextualFile("filled-alignment.ts", "change", 2, 2)

        const flattened = structuralFileOf(
            flattenStructuralFile(file, oldLines.join("\n"), newLines.join("\n"), {
                language: "TypeScript",
                status: "changed",
                aligned_lines: [
                    [0, 0],
                    [1, 1],
                ],
                chunks: [
                    [
                        {
                            lhs: { line_number: 0, changes: [] },
                            rhs: {
                                line_number: 0,
                                changes: [
                                    {
                                        start: 0,
                                        end: newLines[0]?.length ?? 0,
                                        content: newLines[0] ?? "",
                                    },
                                ],
                            },
                        },
                        {
                            lhs: {
                                line_number: 1,
                                changes: [
                                    {
                                        start: 0,
                                        end: oldLines[1]?.length ?? 0,
                                        content: oldLines[1] ?? "",
                                    },
                                ],
                            },
                            rhs: {
                                line_number: 1,
                                changes: [
                                    {
                                        start: 0,
                                        end: newLines[1]?.length ?? 0,
                                        content: newLines[1] ?? "",
                                    },
                                ],
                            },
                        },
                    ],
                ],
            }),
        )

        expect(
            flattened.hunks
                .flatMap((hunk) => hunk.lines)
                .every((line) => line.wordDiff === undefined),
        ).toBe(true)
    })

    test("demotes identical lines inside changed string atoms to context", () => {
        // A one-line edit inside a multiline template literal makes Difftastic
        // mark every line of the string as changed on both sides (the string
        // is one lexical atom). Identical aligned pairs must render as context.
        const oldLines = ["const sql = `", "  id TEXT,", "  channel TEXT CHECK,", "`"]
        const newLines = ["const sql = `", "  id TEXT,", "  channel TEXT,", "`"]
        const file = fakeTextualFile("atom.ts", "change", 1, 1)

        const changesFor = (text: string) => [{ start: 0, end: text.length, content: text }]
        const flattened = structuralFileOf(
            flattenStructuralFile(file, oldLines.join("\n"), newLines.join("\n"), {
                language: "TypeScript",
                status: "changed",
                aligned_lines: [
                    [0, 0],
                    [1, 1],
                    [2, 2],
                    [3, 3],
                ],
                chunks: [
                    oldLines.map((oldText, index) => ({
                        lhs: {
                            line_number: index,
                            changes: changesFor(oldText),
                        },
                        rhs: {
                            line_number: index,
                            changes: changesFor(newLines[index] ?? ""),
                        },
                    })),
                ],
            }),
        )

        const lines = flattened.hunks.flatMap((hunk) => hunk.lines)
        expect(
            lines
                .filter((line) => line.type !== "context")
                .map((line) => [line.type, line.content]),
        ).toEqual([
            ["deletion", "  channel TEXT CHECK,"],
            ["addition", "  channel TEXT,"],
        ])
        expect(lines.filter((line) => line.type === "context").map((line) => line.content)).toEqual(
            ["const sql = `", "  id TEXT,", "`"],
        )
    })

    test("reports formatting-only files instead of hiding them", () => {
        const file = fakeTextualFile("format.ts", "change", 3, 1)

        const flattened = flattenStructuralFile(
            file,
            "function f(){return 1}\n",
            "function f() {\n    return 1\n}\n",
            { language: "TypeScript", status: "unchanged" },
        )

        // The caller keeps the textual diff visible for these files.
        expect(flattened.kind).toBe("formatting-only")
    })

    test("falls back to textual when alignment data is missing", () => {
        const file = fakeTextualFile("created.ts", "new", 1, 0)

        const flattened = flattenStructuralFile(file, "", "const a = 1\n", {
            language: "TypeScript",
            status: "created",
        })

        expect(flattened.kind).toBe("textual")
    })

    test("expands tabs consistently across emphasis segments", () => {
        const oldRaw = "\tconst a = old"
        const newRaw = "\tconst a = updated"
        const file = fakeTextualFile("tabs.ts", "change", 1, 1)

        const oldStart = oldRaw.indexOf("old")
        const newStart = newRaw.indexOf("updated")
        const flattened = structuralFileOf(
            flattenStructuralFile(file, oldRaw, newRaw, {
                language: "TypeScript",
                status: "changed",
                aligned_lines: [[0, 0]],
                chunks: [
                    [
                        {
                            lhs: {
                                line_number: 0,
                                changes: [
                                    {
                                        start: oldStart,
                                        end: oldStart + "old".length,
                                        content: "old",
                                    },
                                ],
                            },
                            rhs: {
                                line_number: 0,
                                changes: [
                                    {
                                        start: newStart,
                                        end: newStart + "updated".length,
                                        content: "updated",
                                    },
                                ],
                            },
                        },
                    ],
                ],
            }),
        )

        const line = flattened.hunks[0]?.lines[0]
        expect(line?.content).toBe("    const a = old")
        expect(line?.wordDiff?.map((segment) => segment.text).join("")).toBe(line?.content)
    })
})
