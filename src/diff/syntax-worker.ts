declare const self: Worker

import type { SupportedLanguages } from "@pierre/diffs"
import { type Theme, type ThemedToken, codeToTokens, isSupportedLanguage } from "@pierre/highlights"
import ayuDark from "@pierre/highlights/themes/ayu-dark"
import githubLight from "@pierre/highlights/themes/github-light"
import type { SyntaxThemeName } from "../theme/syntax"
import { MAX_HIGHLIGHT_LINE_LENGTH } from "./preparation-limits"

/**
 * Tokens for a block of lines, encoded as transferable arrays. Line `i` owns
 * tokens `lineStarts[i]` to `lineStarts[i + 1]`. Each token has a UTF-16
 * length and an index into `colors`; index 0 means "no syntax color".
 */
export interface BlockTokens {
    colors: string[]
    lineStarts: Uint32Array
    lengths: Uint32Array
    colorIds: Uint16Array
}

// Message types
export type WorkerRequest =
    | { type: "init" }
    | {
          type: "tokenize"
          id: number
          content: string
          language: SupportedLanguages
          theme: SyntaxThemeName
      }
    | {
          type: "tokenize-block"
          id: number
          lines: string[]
          language: SupportedLanguages
          theme: SyntaxThemeName
      }

export type WorkerResponse =
    | { type: "ready" }
    | {
          type: "tokens"
          id: number
          tokens: Array<{ content: string; color?: string }>
      }
    | ({ type: "block-tokens"; id: number } & BlockTokens)
    | { type: "error"; id: number; message: string }

// @pierre/highlights compiles its WebAssembly lexers at import, so the worker
// is ready as soon as it receives "init".
const THEMES: Record<SyntaxThemeName, Theme> = {
    "ayu-dark": ayuDark,
    "github-light": githubLight,
}

function tokenize(
    id: number,
    content: string,
    language: SupportedLanguages,
    theme: SyntaxThemeName,
) {
    if (content.length > MAX_HIGHLIGHT_LINE_LENGTH || !isSupportedLanguage(language)) {
        self.postMessage({ type: "tokens", id, tokens: [{ content }] } satisfies WorkerResponse)
        return
    }

    try {
        const result = codeToTokens(content, { lang: language, theme: THEMES[theme] })

        const tokens: Array<{ content: string; color?: string }> = []
        for (const line of result.tokens) {
            for (const token of line) {
                tokens.push({
                    content: token.content,
                    color: token.color,
                })
            }
        }

        self.postMessage({
            type: "tokens",
            id,
            tokens,
        } satisfies WorkerResponse)
    } catch {
        self.postMessage({
            type: "tokens",
            id,
            tokens: [{ content }],
        } satisfies WorkerResponse)
    }
}

/**
 * Tokenize lines as one document so lexer state (block comments, multi-line
 * strings) carries from line to line. Every line's token lengths must add up
 * to the line's length; otherwise that line is reported as one plain token.
 */
function tokenizeBlockLines(
    lines: string[],
    language: SupportedLanguages,
    theme: SyntaxThemeName,
): BlockTokens {
    let lineTokens: ThemedToken[][] | undefined
    if (isSupportedLanguage(language)) {
        try {
            const result = codeToTokens(lines.join("\n"), {
                lang: language,
                theme: THEMES[theme],
            })
            // A line containing another line terminator (such as a lone "\r")
            // would shift every following line. Tokenize lines separately then.
            lineTokens =
                result.tokens.length === lines.length
                    ? result.tokens
                    : lines.map(
                          (line) =>
                              codeToTokens(line, { lang: language, theme: THEMES[theme] })
                                  .tokens[0] ?? [],
                      )
        } catch {}
    }

    const colors = [""]
    const colorIndex = new Map<string, number>()
    const lineStarts = new Uint32Array(lines.length + 1)
    const lengths: number[] = []
    const colorIds: number[] = []
    for (const [index, line] of lines.entries()) {
        lineStarts[index] = lengths.length
        const tokens = lineTokens?.[index] ?? []
        let total = 0
        for (const token of tokens) total += token.content.length
        if (total !== line.length || tokens.length === 0) {
            if (line.length > 0) {
                lengths.push(line.length)
                colorIds.push(0)
            }
            continue
        }
        for (const token of tokens) {
            if (token.content.length === 0) continue
            let colorId = 0
            if (token.color) {
                colorId = colorIndex.get(token.color) ?? colors.length
                if (colorId === colors.length) {
                    colors.push(token.color)
                    colorIndex.set(token.color, colorId)
                }
            }
            lengths.push(token.content.length)
            colorIds.push(colorId)
        }
    }
    lineStarts[lines.length] = lengths.length
    return {
        colors,
        lineStarts,
        lengths: Uint32Array.from(lengths),
        colorIds: Uint16Array.from(colorIds),
    }
}

function tokenizeBlock(
    id: number,
    lines: string[],
    language: SupportedLanguages,
    theme: SyntaxThemeName,
) {
    const block = tokenizeBlockLines(lines, language, theme)
    self.postMessage({ type: "block-tokens", id, ...block } satisfies WorkerResponse, [
        block.lineStarts.buffer as ArrayBuffer,
        block.lengths.buffer as ArrayBuffer,
        block.colorIds.buffer as ArrayBuffer,
    ])
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data

    switch (msg.type) {
        case "init":
            self.postMessage({ type: "ready" } satisfies WorkerResponse)
            break
        case "tokenize":
            tokenize(msg.id, msg.content, msg.language, msg.theme)
            break
        case "tokenize-block":
            tokenizeBlock(msg.id, msg.lines, msg.language, msg.theme)
            break
    }
}
