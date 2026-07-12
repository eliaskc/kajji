import { describe, expect, test } from "bun:test"
import { mergeDialogHints } from "../../../src/context/dialog-hints"

describe("mergeDialogHints", () => {
    test("merges static and generated hints in deterministic order", () => {
        expect(
            mergeDialogHints(
                [{ key: "1-9", label: "open" }],
                [
                    { key: "enter", label: "open", order: 30 },
                    { key: "j / down", label: "next", order: 10 },
                ],
            ),
        ).toEqual([
            { key: "j / down", label: "next", order: 10 },
            { key: "enter", label: "open", order: 30 },
            { key: "1-9", label: "open" },
        ])
    })

    test("deduplicates identical key and label pairs", () => {
        expect(
            mergeDialogHints(
                [{ key: "enter", label: "select" }],
                [
                    { key: "enter", label: "select" },
                    { key: "enter", label: "apply" },
                ],
            ),
        ).toEqual([
            { key: "enter", label: "select" },
            { key: "enter", label: "apply" },
        ])
    })
})
