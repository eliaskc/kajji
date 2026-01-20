declare const self: Worker

import type { SupportedLanguages } from "@pierre/diffs"
import bash from "@shikijs/langs/bash"
import c from "@shikijs/langs/c"
import cpp from "@shikijs/langs/cpp"
import css from "@shikijs/langs/css"
import dockerfile from "@shikijs/langs/dockerfile"
import elixir from "@shikijs/langs/elixir"
import go from "@shikijs/langs/go"
import haskell from "@shikijs/langs/haskell"
import hcl from "@shikijs/langs/hcl"
import html from "@shikijs/langs/html"
import java from "@shikijs/langs/java"
import javascript from "@shikijs/langs/javascript"
import json from "@shikijs/langs/json"
import jsx from "@shikijs/langs/jsx"
import kotlin from "@shikijs/langs/kotlin"
import lua from "@shikijs/langs/lua"
import markdown from "@shikijs/langs/markdown"
import objectiveC from "@shikijs/langs/objective-c"
import php from "@shikijs/langs/php"
import python from "@shikijs/langs/python"
import ruby from "@shikijs/langs/ruby"
import rust from "@shikijs/langs/rust"
import scala from "@shikijs/langs/scala"
import sql from "@shikijs/langs/sql"
import swift from "@shikijs/langs/swift"
import toml from "@shikijs/langs/toml"
import tsx from "@shikijs/langs/tsx"
import typescript from "@shikijs/langs/typescript"
import yaml from "@shikijs/langs/yaml"
import zig from "@shikijs/langs/zig"
import ayuDark from "@shikijs/themes/ayu-dark"
import {
	type Highlighter,
	createHighlighter,
	createJavaScriptRegexEngine,
} from "shiki"

// Message types
export type WorkerRequest =
	| { type: "init" }
	| {
			type: "tokenize"
			id: number
			content: string
			language: SupportedLanguages
	  }

export type WorkerResponse =
	| { type: "ready" }
	| {
			type: "tokens"
			id: number
			tokens: Array<{ content: string; color?: string }>
	  }
	| { type: "error"; id: number; message: string }

// Note: We previously had warmup code that pre-tokenized sample code for each language.
// Testing showed it didn't noticeably improve first-highlight latency, but it did delay
// the "ready" signal, making the first file's highlights appear slower. Removed.

const LANG_MODULES = [
	typescript,
	tsx,
	javascript,
	jsx,
	json,
	html,
	css,
	markdown,
	yaml,
	toml,
	bash,
	c,
	cpp,
	rust,
	go,
	zig,
	java,
	kotlin,
	scala,
	swift,
	objectiveC,
	python,
	ruby,
	php,
	lua,
	elixir,
	haskell,
	sql,
	dockerfile,
	hcl,
]

let highlighter: Highlighter | null = null

async function init() {
	try {
		highlighter = await createHighlighter({
			themes: [ayuDark],
			langs: LANG_MODULES.flat(),
			engine: createJavaScriptRegexEngine(),
		})

		self.postMessage({ type: "ready" } satisfies WorkerResponse)
	} catch (error) {
		self.postMessage({
			type: "error",
			id: -1,
			message: error instanceof Error ? error.message : String(error),
		} satisfies WorkerResponse)
	}
}

function tokenize(id: number, content: string, language: SupportedLanguages) {
	if (!highlighter) {
		self.postMessage({
			type: "error",
			id,
			message: "Highlighter not initialized",
		} satisfies WorkerResponse)
		return
	}

	try {
		const loadedLangs = highlighter.getLoadedLanguages()
		if (!loadedLangs.includes(language)) {
			// Language not loaded, return plain
			self.postMessage({
				type: "tokens",
				id,
				tokens: [{ content }],
			} satisfies WorkerResponse)
			return
		}

		const result = highlighter.codeToTokens(content, {
			lang: language,
			theme: "ayu-dark",
		})

		const tokens: Array<{ content: string; color?: string }> = []
		for (const line of result.tokens) {
			for (const token of line) {
				tokens.push({
					content: token.content,
					color: token.color,
				})
			}
		}

		self.postMessage({ type: "tokens", id, tokens } satisfies WorkerResponse)
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
			init()
			break
		case "tokenize":
			tokenize(msg.id, msg.content, msg.language)
			break
	}
}
