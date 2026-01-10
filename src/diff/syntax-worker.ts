declare const self: Worker

import {
	type DiffsHighlighter,
	type SupportedLanguages,
	getSharedHighlighter,
} from "@pierre/diffs"

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

// Languages to load and warm up
const COMMON_LANGS: SupportedLanguages[] = [
	"typescript",
	"tsx",
	"javascript",
	"jsx",
	"json",
	"html",
	"css",
	"markdown",
	"yaml",
	"toml",
	"bash",
	"python",
	"rust",
	"go",
]

// Warmup code samples
const WARMUP_CODE: Partial<Record<SupportedLanguages, string>> = {
	typescript: `import { foo } from "./bar"
const x: string = "hello"
interface Props { name: string }
function greet(p: Props): void { console.log(p.name) }
export default greet`,
	tsx: `import { useState } from "react"
const App = ({ name }: { name: string }) => {
  const [count, setCount] = useState(0)
  return <div className="app">{name}: {count}</div>
}`,
	javascript: `import foo from "./bar"
const x = "hello"
function greet(name) { console.log(name) }
export default greet`,
	jsx: `import { useState } from "react"
const App = ({ name }) => {
  const [count, setCount] = useState(0)
  return <div className="app">{name}: {count}</div>
}`,
	json: `{"name": "kajji", "version": "1.0.0", "scripts": {"dev": "bun run"}}`,
	html: `<!DOCTYPE html><html><head><title>Test</title></head><body><div class="app"></div></body></html>`,
	css: `.app { color: red; background: #fff; } @media (max-width: 768px) { .app { color: blue; } }`,
	markdown: `# Title\n\n## Subtitle\n\n- Item 1\n- Item 2\n\n\`\`\`ts\nconst x = 1\n\`\`\``,
	yaml: `name: kajji\nversion: 1.0.0\nscripts:\n  dev: bun run`,
	toml: `[package]\nname = "kajji"\nversion = "1.0.0"`,
	bash: `#!/bin/bash\nset -e\necho "hello $USER"\nif [ -f "file" ]; then cat file; fi`,
	python: `import os\ndef greet(name: str) -> None:\n    print(f"Hello {name}")\nif __name__ == "__main__":\n    greet("world")`,
	rust: `use std::io;\nfn main() -> Result<(), io::Error> {\n    println!("Hello");\n    Ok(())\n}`,
	go: `package main\nimport "fmt"\nfunc main() {\n    fmt.Println("Hello")\n}`,
}

let highlighter: DiffsHighlighter | null = null

async function init() {
	highlighter = await getSharedHighlighter({
		themes: ["ayu-dark"],
		langs: COMMON_LANGS,
	})

	// Warm up all grammars
	for (const lang of COMMON_LANGS) {
		const code = WARMUP_CODE[lang]
		if (code) {
			try {
				highlighter.codeToTokens(code, { lang, theme: "ayu-dark" })
			} catch {
				// Ignore warmup failures
			}
		}
	}

	self.postMessage({ type: "ready" } satisfies WorkerResponse)
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
