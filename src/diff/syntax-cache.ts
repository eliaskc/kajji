import type { SupportedLanguages } from "@pierre/diffs"
import { tokenizeLineSync, type SyntaxToken } from "./syntax"

const CACHE_MAX_SIZE = 500
const syntaxCache = new Map<string, SyntaxToken[]>()

export function tokenizeWithCache(
	content: string,
	language: SupportedLanguages,
): SyntaxToken[] {
	const key = `${language}\0${content}`

	const cached = syntaxCache.get(key)
	if (cached) {
		return cached
	}

	const tokens = tokenizeLineSync(content, language)

	if (syntaxCache.size >= CACHE_MAX_SIZE) {
		const firstKey = syntaxCache.keys().next().value
		if (firstKey) {
			syntaxCache.delete(firstKey)
		}
	}

	syntaxCache.set(key, tokens)
	return tokens
}

export function clearSyntaxCache(): void {
	syntaxCache.clear()
}

export function getSyntaxCacheSize(): number {
	return syntaxCache.size
}
