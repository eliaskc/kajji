import { describe, expect, test } from "bun:test"
import { parseDiffString } from "../../../src/diff/parser"
import { findBinaryFiles } from "../../../src/utils/diff-binary"

function binaryBlock(header: string, marker = "Binary files a/x and b/x differ") {
    return [header, "index 1111111..2222222 100644", marker].join("\n")
}

describe("findBinaryFiles", () => {
    test("finds plain paths, including paths with spaces", () => {
        const diff = binaryBlock("diff --git a/assets/my logo.png b/assets/my logo.png")
        expect([...findBinaryFiles(diff)]).toEqual(["assets/my logo.png"])
    })

    test("decodes C-quoted UTF-8 octal escapes", () => {
        const diff = binaryBlock('diff --git "a/caf\\303\\251.png" "b/caf\\303\\251.png"')
        expect([...findBinaryFiles(diff)]).toEqual(["café.png"])
    })

    test("decodes named escapes", () => {
        const diff = binaryBlock('diff --git "a/we\\"ird\\ttab.bin" "b/we\\"ird\\ttab.bin"')
        expect([...findBinaryFiles(diff)]).toEqual(['we"ird\ttab.bin'])
    })

    test("handles renames where only one side is quoted", () => {
        const diff = binaryBlock('diff --git a/plain.png "b/caf\\303\\251.png"', "GIT binary patch")
        expect(findBinaryFiles(diff)).toEqual(new Set(["plain.png", "café.png"]))
    })

    test("ignores text files", () => {
        const diff = [
            "diff --git a/a.ts b/a.ts",
            "--- a/a.ts",
            "+++ b/a.ts",
            "@@ -1 +1 @@",
            "-a",
            "+b",
        ].join("\n")
        expect(findBinaryFiles(diff).size).toBe(0)
    })
})

describe("parseDiffString binary detection", () => {
    test("marks a binary file with a C-quoted path", () => {
        const diff = [
            binaryBlock(
                'diff --git "a/caf\\303\\251.png" "b/caf\\303\\251.png"',
                'Binary files "a/caf\\303\\251.png" and "b/caf\\303\\251.png" differ',
            ),
            "",
        ].join("\n")
        const files = parseDiffString(diff)
        expect(files.map((file) => [file.name, file.isBinary])).toEqual([["café.png", true]])
    })
})
