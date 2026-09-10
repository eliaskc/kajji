import { expect, test } from "bun:test"

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
        const samples: [string, string][] = [
            ["typescript", "const answer: number = 42"],
            ["tsx", 'const view = <div title="hello">{42}</div>'],
            ["javascript", "const pattern = /hello+/gi"],
            ["jsx", "const view = <div>{42}</div>"],
            ["json", '{"answer": 42}'],
            ["html", '<div class="hello">World</div>'],
            ["css", ".hello { color: red; }"],
            ["markdown", "# Hello **world**"],
            ["yaml", 'answer: "hello"'],
            ["toml", 'answer = "hello"'],
            ["bash", 'echo "$HOME"'],
            ["c", "int answer = 42;"],
            ["cpp", 'std::string answer = "hello";'],
            ["rust", 'let answer: &str = "hello";'],
            ["go", 'var answer string = "hello"'],
            ["zig", "const answer: u32 = 42;"],
            ["java", 'String answer = "hello";'],
            ["kotlin", 'val answer = "hello"'],
            ["scala", 'val answer = "hello"'],
            ["swift", 'let answer = "Hej, 雪"'],
            ["objective-c", 'NSString *answer = @"hello";'],
            ["python", 'answer = f"hello {42}"'],
            ["ruby", 'answer = "hello #{42}"'],
            ["php", '<?php echo "hello"; ?>'],
            ["lua", 'local answer = "hello"'],
            ["elixir", 'answer = "hello"'],
            ["haskell", 'answer = "hello"'],
            ["sql", "SELECT name FROM users WHERE id = 42;"],
            ["dockerfile", "FROM alpine:latest"],
            ["hcl", 'variable "answer" { default = 42 }'],
        ]
        for (const theme of ["ayu-dark", "github-light"]) {
            for (const [language, content] of samples) {
                const result = await request({ type: "tokenize", id: 1, content, language, theme })
                expect(result.type).toBe("tokens")
                expect(result.tokens.map((token) => token.content).join("")).toBe(content)
                expect(result.tokens.some((token) => token.color)).toBe(true)
                expect(new Set(result.tokens.map((token) => token.color)).size).toBeGreaterThan(1)
            }
        }
        const unknown = await request({
            type: "tokenize",
            id: 3,
            content: "unchanged text",
            language: "unknown-language",
            theme: "ayu-dark",
        })
        expect(unknown.tokens).toEqual([{ content: "unchanged text" }])
    } finally {
        worker.terminate()
    }
}, 30_000)
