declare const self: Worker

import type { SupportedLanguages } from "@pierre/diffs"
import { type Theme, codeToTokens, isSupportedLanguage } from "@pierre/highlights"
import ayuDark from "@pierre/highlights/themes/ayu-dark"
import githubLight from "@pierre/highlights/themes/github-light"
import type { SyntaxThemeName } from "../theme/syntax"
import { MAX_HIGHLIGHT_LINE_LENGTH } from "./preparation-limits"

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

export type WorkerResponse =
    | { type: "ready" }
    | {
          type: "tokens"
          id: number
          tokens: Array<{ content: string; color?: string }>
      }
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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data

    switch (msg.type) {
        case "init":
            self.postMessage({ type: "ready" } satisfies WorkerResponse)
            break
        case "tokenize":
            tokenize(msg.id, msg.content, msg.language, msg.theme)
            break
    }
}
