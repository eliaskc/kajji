import { describe, expect, test } from "bun:test"
import { computeWordDiff } from "../../../src/diff/word-diff"

describe("computeWordDiff", () => {
    test("preserves text while leaving spaces between changed words neutral", () => {
        const result = computeWordDiff(
            "const oldValue = 1",
            "const newValue = 2",
        )

        expect(result.old.map((segment) => segment.text).join("")).toBe(
            "const oldValue = 1",
        )
        expect(result.new.map((segment) => segment.text).join("")).toBe(
            "const newValue = 2",
        )
        expect(
            [...result.old, ...result.new]
                .filter((segment) => /^\s+$/.test(segment.text))
                .every((segment) => segment.type === "unchanged"),
        ).toBe(true)
    })

    test("joins changed words separated by one character", () => {
        const result = computeWordDiff("foo.bar.baz", "qux.zap.zip")

        expect(result.old).toEqual([{ text: "foo.bar.baz", type: "removed" }])
        expect(result.new).toEqual([{ text: "qux.zap.zip", type: "added" }])
    })

    test("does not absorb a single-character suffix", () => {
        const result = computeWordDiff("foo.", "bar.")

        expect(result.old).toEqual([
            { text: "foo", type: "removed" },
            { text: ".", type: "unchanged" },
        ])
        expect(result.new).toEqual([
            { text: "bar", type: "added" },
            { text: ".", type: "unchanged" },
        ])
    })

    test("does not highlight indentation changes", () => {
        const result = computeWordDiff("  value", "    value")

        expect(result.old).toEqual([{ text: "  value", type: "unchanged" }])
        expect(result.new).toEqual([{ text: "    value", type: "unchanged" }])
    })

    test("never marks a whitespace-only segment as changed", () => {
        const result = computeWordDiff(
            "            <scrollbox ref={scrollRef}>",
            "                <box flexGrow={1} paddingRight={1}>",
        )

        for (const segment of [...result.old, ...result.new]) {
            if (/^\s+$/.test(segment.text)) {
                expect(segment.type).toBe("unchanged")
            }
            if (segment.type !== "unchanged") {
                expect(segment.text).toBe(segment.text.trim())
            }
        }
    })
})
