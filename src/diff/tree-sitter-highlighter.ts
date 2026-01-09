/**
 * Tree-sitter based native syntax highlighter
 *
 * This provides ~10x faster tokenization compared to shiki by using
 * tree-sitter's native C parser via Node-API bindings.
 *
 * Install dependencies:
 *   bun add tree-sitter tree-sitter-typescript tree-sitter-javascript \
 *     tree-sitter-json tree-sitter-css tree-sitter-html tree-sitter-python \
 *     tree-sitter-go tree-sitter-rust tree-sitter-bash tree-sitter-yaml \
 *     tree-sitter-c tree-sitter-cpp tree-sitter-java tree-sitter-ruby
 */

import type { SyntaxToken } from "./syntax"
import { tracer } from "../utils/tracer"

// Theme colors (ayu-dark inspired)
const THEME = {
	keyword: "#FF7733",
	storage: "#FF7733",
	type: "#59C2FF",
	typeBuiltin: "#59C2FF",
	function: "#FFB454",
	functionCall: "#FFB454",
	method: "#FFB454",
	variable: "#CBCCC6",
	variableParameter: "#D2A6FF",
	constant: "#D2A6FF",
	string: "#C2D94C",
	stringSpecial: "#95E6CB",
	number: "#FFEE99",
	operator: "#F29668",
	punctuation: "#CBCCC680",
	comment: "#5C6773",
	property: "#CBCCC6",
	tag: "#39BAE6",
	attribute: "#FFB454",
	namespace: "#59C2FF",
	error: "#FF3333",
	default: "#CBCCC6",
} as const

// Language aliases
const LANG_ALIASES: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	py: "python",
	rb: "ruby",
	yml: "yaml",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	md: "markdown",
	rs: "rust",
	cpp: "c_plus_plus",
	"c++": "c_plus_plus",
	hpp: "c_plus_plus",
}

// Map tree-sitter node types to theme colors
const NODE_TYPE_COLORS: Record<string, string> = {
	// Keywords
	keyword: THEME.keyword,
	"keyword.control": THEME.keyword,
	"keyword.function": THEME.keyword,
	"keyword.operator": THEME.operator,
	"keyword.return": THEME.keyword,
	"keyword.import": THEME.keyword,
	"keyword.export": THEME.keyword,
	if: THEME.keyword,
	else: THEME.keyword,
	for: THEME.keyword,
	while: THEME.keyword,
	return: THEME.keyword,
	import: THEME.keyword,
	export: THEME.keyword,
	from: THEME.keyword,
	as: THEME.keyword,
	const: THEME.keyword,
	let: THEME.keyword,
	var: THEME.keyword,
	function: THEME.keyword,
	class: THEME.keyword,
	extends: THEME.keyword,
	implements: THEME.keyword,
	interface: THEME.keyword,
	type: THEME.keyword,
	enum: THEME.keyword,
	async: THEME.keyword,
	await: THEME.keyword,
	new: THEME.keyword,
	this: THEME.keyword,
	super: THEME.keyword,
	try: THEME.keyword,
	catch: THEME.keyword,
	finally: THEME.keyword,
	throw: THEME.keyword,
	typeof: THEME.keyword,
	instanceof: THEME.keyword,
	in: THEME.keyword,
	of: THEME.keyword,
	break: THEME.keyword,
	continue: THEME.keyword,
	switch: THEME.keyword,
	case: THEME.keyword,
	default: THEME.keyword,
	static: THEME.keyword,
	public: THEME.keyword,
	private: THEME.keyword,
	protected: THEME.keyword,
	readonly: THEME.keyword,
	abstract: THEME.keyword,
	override: THEME.keyword,
	declare: THEME.keyword,
	namespace: THEME.keyword,
	module: THEME.keyword,

	// Types
	type_identifier: THEME.type,
	predefined_type: THEME.typeBuiltin,
	builtin_type: THEME.typeBuiltin,
	primitive_type: THEME.typeBuiltin,
	type_annotation: THEME.type,
	generic_type: THEME.type,

	// Functions
	function_declaration: THEME.function,
	method_definition: THEME.method,
	function_name: THEME.function,
	call_expression: THEME.functionCall,
	method_call: THEME.method,
	arrow_function: THEME.function,

	// Variables and parameters
	identifier: THEME.variable,
	variable_declarator: THEME.variable,
	formal_parameters: THEME.variableParameter,
	required_parameter: THEME.variableParameter,
	optional_parameter: THEME.variableParameter,
	rest_pattern: THEME.variableParameter,
	shorthand_property_identifier: THEME.property,
	shorthand_property_identifier_pattern: THEME.property,

	// Properties
	property_identifier: THEME.property,
	field_identifier: THEME.property,
	member_expression: THEME.property,

	// Strings
	string: THEME.string,
	string_fragment: THEME.string,
	template_string: THEME.string,
	template_literal_type: THEME.string,
	string_literal: THEME.string,
	raw_string_literal: THEME.string,
	escape_sequence: THEME.stringSpecial,
	regex: THEME.stringSpecial,
	regex_pattern: THEME.stringSpecial,

	// Numbers
	number: THEME.number,
	integer: THEME.number,
	float: THEME.number,
	integer_literal: THEME.number,
	float_literal: THEME.number,

	// Constants
	true: THEME.constant,
	false: THEME.constant,
	null: THEME.constant,
	undefined: THEME.constant,
	nil: THEME.constant,
	none: THEME.constant,

	// Operators
	"!": THEME.operator,
	"~": THEME.operator,
	"+": THEME.operator,
	"-": THEME.operator,
	"*": THEME.operator,
	"/": THEME.operator,
	"%": THEME.operator,
	"**": THEME.operator,
	"++": THEME.operator,
	"--": THEME.operator,
	"==": THEME.operator,
	"===": THEME.operator,
	"!=": THEME.operator,
	"!==": THEME.operator,
	"<": THEME.operator,
	"<=": THEME.operator,
	">": THEME.operator,
	">=": THEME.operator,
	"&&": THEME.operator,
	"||": THEME.operator,
	"??": THEME.operator,
	"&": THEME.operator,
	"|": THEME.operator,
	"^": THEME.operator,
	"<<": THEME.operator,
	">>": THEME.operator,
	">>>": THEME.operator,
	"=": THEME.operator,
	"+=": THEME.operator,
	"-=": THEME.operator,
	"*=": THEME.operator,
	"/=": THEME.operator,
	"%=": THEME.operator,
	"=>": THEME.operator,
	"?.": THEME.operator,
	"...": THEME.operator,
	binary_expression: THEME.default,
	unary_expression: THEME.default,
	ternary_expression: THEME.default,
	assignment_expression: THEME.default,

	// Punctuation
	"(": THEME.punctuation,
	")": THEME.punctuation,
	"[": THEME.punctuation,
	"]": THEME.punctuation,
	"{": THEME.punctuation,
	"}": THEME.punctuation,
	":": THEME.punctuation,
	";": THEME.punctuation,
	",": THEME.punctuation,
	".": THEME.punctuation,

	// Comments
	comment: THEME.comment,
	line_comment: THEME.comment,
	block_comment: THEME.comment,
	hash_bang_line: THEME.comment,

	// JSX/TSX
	jsx_element: THEME.default,
	jsx_self_closing_element: THEME.default,
	jsx_opening_element: THEME.tag,
	jsx_closing_element: THEME.tag,
	jsx_attribute: THEME.attribute,
	jsx_text: THEME.default,

	// HTML
	tag_name: THEME.tag,
	attribute_name: THEME.attribute,
	attribute_value: THEME.string,

	// Error
	ERROR: THEME.error,
}

export type TreeSitterLanguage =
	| "typescript"
	| "tsx"
	| "javascript"
	| "jsx"
	| "json"
	| "css"
	| "html"
	| "python"
	| "go"
	| "rust"
	| "bash"
	| "yaml"
	| "c"
	| "c_plus_plus"
	| "java"
	| "ruby"
	| "markdown"
	| "toml"

interface TreeSitterNode {
	type: string
	text: string
	startIndex: number
	endIndex: number
	startPosition: { row: number; column: number }
	endPosition: { row: number; column: number }
	children: TreeSitterNode[]
	childCount: number
	namedChildren: TreeSitterNode[]
	namedChildCount: number
	parent: TreeSitterNode | null
	firstChild: TreeSitterNode | null
	lastChild: TreeSitterNode | null
	nextSibling: TreeSitterNode | null
	previousSibling: TreeSitterNode | null
	isNamed: boolean
	isMissing: boolean
	hasError: boolean
}

interface TreeSitterTree {
	rootNode: TreeSitterNode
}

interface TreeSitterParser {
	setLanguage(language: unknown): void
	parse(input: string): TreeSitterTree
}

interface TreeSitterGrammar {
	default?: unknown
}

// Dynamic imports for tree-sitter and grammars
let Parser: (new () => TreeSitterParser) | null = null
const loadedLanguages = new Map<string, unknown>()
let initPromise: Promise<boolean> | null = null
let initComplete = false

const GRAMMAR_PACKAGES: Record<TreeSitterLanguage, string> = {
	typescript: "tree-sitter-typescript",
	tsx: "tree-sitter-typescript",
	javascript: "tree-sitter-javascript",
	jsx: "tree-sitter-javascript", // Uses the same package
	json: "tree-sitter-json",
	css: "tree-sitter-css",
	html: "tree-sitter-html",
	python: "tree-sitter-python",
	go: "tree-sitter-go",
	rust: "tree-sitter-rust",
	bash: "tree-sitter-bash",
	yaml: "tree-sitter-yaml",
	c: "tree-sitter-c",
	c_plus_plus: "tree-sitter-cpp",
	java: "tree-sitter-java",
	ruby: "tree-sitter-ruby",
	markdown: "tree-sitter-markdown",
	toml: "tree-sitter-toml",
}

async function loadGrammar(lang: TreeSitterLanguage): Promise<unknown | null> {
	if (loadedLanguages.has(lang)) {
		return loadedLanguages.get(lang) ?? null
	}

	const packageName = GRAMMAR_PACKAGES[lang]
	if (!packageName) return null

	try {
		// For tsx/typescript, need to access the specific language
		if (lang === "tsx" || lang === "typescript") {
			const mod = (await import(packageName)) as TreeSitterGrammar & {
				tsx?: unknown
				typescript?: unknown
			}
			const grammar = lang === "tsx" ? mod.tsx : mod.typescript
			if (grammar) {
				loadedLanguages.set(lang, grammar)
				return grammar
			}
		} else {
			const mod = (await import(packageName)) as TreeSitterGrammar
			const grammar = mod.default ?? mod
			if (grammar) {
				loadedLanguages.set(lang, grammar)
				return grammar
			}
		}
	} catch {
		// Grammar not installed
	}

	return null
}

export async function initTreeSitter(): Promise<boolean> {
	if (initComplete) return true
	if (initPromise) return initPromise

	initPromise = (async () => {
		const trace = tracer.startTrace("tree-sitter-init")

		try {
			const loadSpan = trace.startSpan("load-parser")
			const treeSitterModule = await import("tree-sitter")
			Parser = treeSitterModule.default as new () => TreeSitterParser
			loadSpan.end()

			// Pre-load common languages
			const preloadSpan = trace.startSpan("preload-languages")
			const commonLangs: TreeSitterLanguage[] = [
				"typescript",
				"tsx",
				"javascript",
				"json",
			]

			const results = await Promise.allSettled(
				commonLangs.map((lang) => loadGrammar(lang)),
			)

			preloadSpan.addMetadata({
				requested: commonLangs.length,
				loaded: results.filter((r) => r.status === "fulfilled" && r.value).length,
			})
			preloadSpan.end()

			initComplete = true
			trace.addMetadata({ success: true, loadedLanguages: loadedLanguages.size })
			trace.end()
			return true
		} catch (err) {
			trace.addMetadata({
				success: false,
				error: err instanceof Error ? err.message : String(err),
			})
			trace.end()
			initComplete = false
			return false
		}
	})()

	return initPromise
}

export function isTreeSitterReady(): boolean {
	return initComplete && Parser !== null
}

export function getLoadedLanguages(): string[] {
	return Array.from(loadedLanguages.keys())
}

function normalizeLanguage(lang: string): TreeSitterLanguage | null {
	const normalized = LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()
	if (normalized in GRAMMAR_PACKAGES) {
		return normalized as TreeSitterLanguage
	}
	return null
}

function getColorForNode(node: TreeSitterNode, parentType?: string): string {
	// Check node type first
	if (NODE_TYPE_COLORS[node.type]) {
		return NODE_TYPE_COLORS[node.type]
	}

	// Check text content for certain node types
	if (node.type === "identifier" && parentType) {
		// Function names
		if (
			parentType === "function_declaration" ||
			parentType === "method_definition" ||
			parentType === "arrow_function"
		) {
			return THEME.function
		}
		// Type identifiers
		if (parentType === "type_annotation" || parentType === "generic_type") {
			return THEME.type
		}
	}

	// Property access
	if (node.type === "property_identifier" || node.type === "field_identifier") {
		return THEME.property
	}

	return THEME.default
}

// Node types that should be colored as a whole (don't recurse into children)
const TERMINAL_TYPES = new Set([
	"string",
	"string_literal",
	"template_string",
	"number",
	"integer",
	"float",
	"comment",
	"line_comment",
	"block_comment",
	"regex",
	"true",
	"false",
	"null",
	"undefined",
])

function collectTokens(
	node: TreeSitterNode,
	tokens: Array<{ start: number; end: number; color: string }>,
	parentType?: string,
): void {
	// Terminal semantic nodes - color as a whole, don't recurse
	if (TERMINAL_TYPES.has(node.type)) {
		const color = getColorForNode(node, parentType)
		tokens.push({
			start: node.startIndex,
			end: node.endIndex,
			color,
		})
		return
	}

	// Leaf nodes (no children) or unnamed nodes emit tokens
	if (node.childCount === 0 || !node.isNamed) {
		const color = getColorForNode(node, parentType)
		tokens.push({
			start: node.startIndex,
			end: node.endIndex,
			color,
		})
		return
	}

	// Recurse into children
	for (let i = 0; i < node.childCount; i++) {
		const child = node.children[i]
		if (child) {
			collectTokens(child, tokens, node.type)
		}
	}
}

// Parser instance pool for reuse
const parserPool: TreeSitterParser[] = []
const MAX_POOL_SIZE = 4

function getParser(): TreeSitterParser | null {
	if (!Parser) return null

	if (parserPool.length > 0) {
		return parserPool.pop()!
	}

	return new Parser()
}

function releaseParser(parser: TreeSitterParser): void {
	if (parserPool.length < MAX_POOL_SIZE) {
		parserPool.push(parser)
	}
}

export async function tokenizeWithTreeSitter(
	content: string,
	language: string,
): Promise<SyntaxToken[]> {
	if (!initComplete) {
		await initTreeSitter()
	}

	if (!Parser) {
		return [{ content }]
	}

	const normalizedLang = normalizeLanguage(language)
	if (!normalizedLang) {
		return [{ content }]
	}

	const grammar = await loadGrammar(normalizedLang)
	if (!grammar) {
		return [{ content }]
	}

	const parser = getParser()
	if (!parser) {
		return [{ content }]
	}

	try {
		parser.setLanguage(grammar)
		const tree = parser.parse(content)

		const rawTokens: Array<{ start: number; end: number; color: string }> = []
		collectTokens(tree.rootNode, rawTokens)

		// Sort by position and merge adjacent tokens with same color
		rawTokens.sort((a, b) => a.start - b.start)

		const tokens: SyntaxToken[] = []
		let lastEnd = 0

		for (const tok of rawTokens) {
			// Fill gaps with default color
			if (tok.start > lastEnd) {
				const gap = content.slice(lastEnd, tok.start)
				if (gap) {
					tokens.push({ content: gap, color: THEME.default })
				}
			}

			const text = content.slice(tok.start, tok.end)
			if (text) {
				// Merge with previous if same color
				const prev = tokens[tokens.length - 1]
				if (prev && prev.color === tok.color) {
					prev.content += text
				} else {
					tokens.push({ content: text, color: tok.color })
				}
			}

			lastEnd = Math.max(lastEnd, tok.end)
		}

		// Handle remaining content
		if (lastEnd < content.length) {
			tokens.push({
				content: content.slice(lastEnd),
				color: THEME.default,
			})
		}

		releaseParser(parser)
		return tokens.length > 0 ? tokens : [{ content }]
	} catch {
		releaseParser(parser)
		return [{ content }]
	}
}

export function tokenizeWithTreeSitterSync(
	content: string,
	language: string,
): SyntaxToken[] {
	if (!initComplete || !Parser) {
		return [{ content }]
	}

	const normalizedLang = normalizeLanguage(language)
	if (!normalizedLang) {
		return [{ content }]
	}

	const grammar = loadedLanguages.get(normalizedLang)
	if (!grammar) {
		return [{ content }]
	}

	const parser = getParser()
	if (!parser) {
		return [{ content }]
	}

	try {
		parser.setLanguage(grammar)
		const tree = parser.parse(content)

		const rawTokens: Array<{ start: number; end: number; color: string }> = []
		collectTokens(tree.rootNode, rawTokens)

		rawTokens.sort((a, b) => a.start - b.start)

		const tokens: SyntaxToken[] = []
		let lastEnd = 0

		for (const tok of rawTokens) {
			if (tok.start > lastEnd) {
				const gap = content.slice(lastEnd, tok.start)
				if (gap) {
					tokens.push({ content: gap, color: THEME.default })
				}
			}

			const text = content.slice(tok.start, tok.end)
			if (text) {
				const prev = tokens[tokens.length - 1]
				if (prev && prev.color === tok.color) {
					prev.content += text
				} else {
					tokens.push({ content: text, color: tok.color })
				}
			}

			lastEnd = Math.max(lastEnd, tok.end)
		}

		if (lastEnd < content.length) {
			tokens.push({
				content: content.slice(lastEnd),
				color: THEME.default,
			})
		}

		releaseParser(parser)
		return tokens.length > 0 ? tokens : [{ content }]
	} catch {
		releaseParser(parser)
		return [{ content }]
	}
}

/**
 * Get highlighting statistics for debugging
 */
export function getTreeSitterStats(): {
	ready: boolean
	loadedLanguages: string[]
	parserPoolSize: number
} {
	return {
		ready: initComplete,
		loadedLanguages: Array.from(loadedLanguages.keys()),
		parserPoolSize: parserPool.length,
	}
}
