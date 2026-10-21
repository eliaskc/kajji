import { expect, test } from "bun:test"
import * as bundledThemes from "@pierre/highlights/themes"
import type { BlockTokens } from "../../../src/diff/syntax-worker"
import { syntaxThemeNames } from "../../../src/theme/syntax"

test("syntax worker highlights code with both bundled themes", async () => {
    const worker = new Worker(new URL("../../../src/diff/syntax-worker.ts", import.meta.url).href)
    const request = (message: object) =>
        new Promise<{ type: string; tokens: Array<{ content: string; color?: string }> }>(
            (resolve, reject) => {
                worker.onmessage = (event) => {
                    if (event.data.type === "error") reject(new Error(event.data.message))
                    else resolve(event.data)
                }
                worker.onerror = (event) => reject(new Error(event.message))
                worker.postMessage(message)
            },
        )

    try {
        expect((await request({ type: "init" })).type).toBe("ready")
        const longLine = "const long = " + "x".repeat(100_000)
        const fallback = await request({
            type: "tokenize",
            id: 2,
            content: longLine,
            language: "typescript",
            theme: "ayu-dark",
        })
        expect(fallback.tokens).toEqual([{ content: longLine }])
        for (const theme of ["ayu-dark", "github-light"]) {
            const result = await request({
                type: "tokenize",
                id: 1,
                content: "const answer = 42",
                language: "typescript",
                theme,
            })
            expect(result.type).toBe("tokens")
            expect(result.tokens.map((token: { content: string }) => token.content).join("")).toBe(
                "const answer = 42",
            )
            expect(result.tokens.some((token: { color?: string }) => token.color)).toBe(true)
        }
    } finally {
        worker.terminate()
    }
})

test("syntax worker carries lexer state across the lines of a block", async () => {
    const worker = new Worker(new URL("../../../src/diff/syntax-worker.ts", import.meta.url).href)
    const request = (message: object) =>
        new Promise<{ type: string } & BlockTokens>((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data)
            worker.onerror = (event) => reject(new Error(event.message))
            worker.postMessage(message)
        })

    try {
        await request({ type: "init" })
        const lines = ["/**", " * Fetches a user.", " */", "const answer = 42", ""]
        const block = await request({
            type: "tokenize-block",
            id: 1,
            lines,
            language: "typescript",
            theme: "ayu-dark",
        })
        expect(block.type).toBe("block-tokens")
        const lineColors = (index: number) => {
            const colors: string[] = []
            let length = 0
            for (
                let token = block.lineStarts[index]!;
                token < block.lineStarts[index + 1]!;
                token++
            ) {
                colors.push(block.colors[block.colorIds[token]!]!)
                length += block.lengths[token]!
            }
            expect(length).toBe(lines[index]!.length)
            return new Set(colors)
        }
        const commentColor = [...lineColors(0)]
        expect(commentColor).toHaveLength(1)
        // Highlighted alone, " * Fetches a user." is not a comment.
        expect([...lineColors(1)]).toEqual(commentColor)
        expect([...lineColors(2)]).toEqual(commentColor)
        expect(lineColors(3).has(commentColor[0]!)).toBe(false)
        expect(block.lineStarts[4]).toBe(block.lineStarts[5])
    } finally {
        worker.terminate()
    }
})

test("every bundled Highlights theme is selectable and resolves in the worker", async () => {
    const exported = Object.keys(bundledThemes).filter(
        (name) => name !== "cssVariables" && name !== "toCSS",
    )
    const listed = syntaxThemeNames.map((name) =>
        name.replace(/-(\w)/g, (_, char: string) => char.toUpperCase()),
    )
    expect([...listed].sort()).toEqual(exported.sort())

    const worker = new Worker(new URL("../../../src/diff/syntax-worker.ts", import.meta.url).href)
    const responses = new Map<number, Array<{ content: string; color?: string }>>()
    const done = new Promise<void>((resolve, reject) => {
        worker.onmessage = (event) => {
            if (event.data.type !== "tokens") return
            responses.set(event.data.id, event.data.tokens)
            if (responses.size === syntaxThemeNames.length) resolve()
        }
        worker.onerror = (event) => reject(new Error(event.message))
    })
    try {
        worker.postMessage({ type: "init" })
        for (const [id, theme] of syntaxThemeNames.entries()) {
            worker.postMessage({
                type: "tokenize",
                id,
                content: "const answer = 42 // note",
                language: "typescript",
                theme,
            })
        }
        await done
        // An unresolved theme falls back to one uncolored token.
        const unresolved = syntaxThemeNames.filter((_, id) =>
            responses.get(id)!.every((token) => !token.color),
        )
        expect(unresolved).toEqual([])
    } finally {
        worker.terminate()
    }
})
