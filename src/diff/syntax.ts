import { type SupportedLanguages, getFiletypeFromFileName } from "@pierre/diffs"
import { createSignal } from "solid-js"
import type { SyntaxThemeName } from "../theme/syntax"
import { registerBenchmarkState } from "../utils/benchmark"
import { MAX_HIGHLIGHT_LINE_LENGTH } from "./preparation-limits"
import type { BlockTokens, WorkerRequest, WorkerResponse } from "./syntax-worker"

export interface SyntaxToken {
    content: string
    color?: string
}

// Global reactive signal for highlighter readiness
const [highlighterReady, setHighlighterReady] = createSignal(false)
export { highlighterReady }

// Signal to trigger re-renders when new tokens arrive from worker
// Increment this to invalidate memos that depend on it
const [tokenVersion, setTokenVersion] = createSignal(0)
export { tokenVersion }

// Token cache: Map<"theme:language:content", tokens>
// Keep this bounded: users can view many unique diff lines in a long-running
// session, and an unbounded syntax cache looks like a memory leak.
const MAX_TOKEN_CACHE_ENTRIES = 5000
const MAX_TOKEN_CACHE_KEY_CHARS = 1_000_000
const tokenCache = new Map<string, SyntaxToken[]>()
let tokenCacheKeyChars = 0

function getCachedTokens(cacheKey: string): SyntaxToken[] | undefined {
    const cached = tokenCache.get(cacheKey)
    if (!cached) return undefined

    // Refresh insertion order so the Map behaves as an LRU cache.
    tokenCache.delete(cacheKey)
    tokenCache.set(cacheKey, cached)
    return cached
}

function setCachedTokens(cacheKey: string, tokens: SyntaxToken[]): void {
    if (tokenCache.has(cacheKey)) {
        tokenCache.delete(cacheKey)
        tokenCacheKeyChars -= cacheKey.length
    }

    tokenCache.set(cacheKey, tokens)
    tokenCacheKeyChars += cacheKey.length

    while (
        tokenCache.size > 1 &&
        (tokenCache.size > MAX_TOKEN_CACHE_ENTRIES ||
            tokenCacheKeyChars > MAX_TOKEN_CACHE_KEY_CHARS)
    ) {
        const oldestKey = tokenCache.keys().next().value
        if (!oldestKey) break
        tokenCache.delete(oldestKey)
        tokenCacheKeyChars -= oldestKey.length
    }
}

/**
 * Consecutive lines from one side of a hunk. They are tokenized together so
 * multi-line constructs such as block comments keep their lexer state.
 * Lines are stored without terminators; long lines are blanked.
 */
export interface SyntaxBlock {
    readonly lines: string[]
    /** Content hash, computed on first use. */
    hash?: string
}

/** One line's position within a {@link SyntaxBlock}. */
export interface SyntaxLineRef {
    block: SyntaxBlock
    index: number
}

// Block tokens keyed by "theme:language:hash". Bounded by total token count.
const MAX_BLOCK_CACHE_TOKENS = 2_000_000
const blockCache = new Map<string, BlockTokens>()
let blockCacheTokens = 0

function getBlockKey(block: SyntaxBlock, language: SupportedLanguages, theme: SyntaxThemeName) {
    if (block.hash === undefined) {
        let hash = 0n
        for (const line of block.lines) hash = Bun.hash(line, hash) as bigint
        block.hash = `${hash.toString(36)}:${block.lines.length}`
    }
    return `${theme}:${language}:${block.hash}`
}

function setCachedBlock(key: string, tokens: BlockTokens): void {
    const previous = blockCache.get(key)
    if (previous) {
        blockCache.delete(key)
        blockCacheTokens -= previous.lengths.length
    }
    blockCache.set(key, tokens)
    blockCacheTokens += tokens.lengths.length
    while (blockCache.size > 1 && blockCacheTokens > MAX_BLOCK_CACHE_TOKENS) {
        const oldestKey = blockCache.keys().next().value
        if (!oldestKey) break
        blockCacheTokens -= blockCache.get(oldestKey)?.lengths.length ?? 0
        blockCache.delete(oldestKey)
    }
}

function lineTokensFromBlock(
    tokens: BlockTokens,
    index: number,
    content: string,
): SyntaxToken[] | undefined {
    const start = tokens.lineStarts[index]
    const end = tokens.lineStarts[index + 1]
    if (start === undefined || end === undefined) return undefined
    const result: SyntaxToken[] = []
    let offset = 0
    for (let token = start; token < end; token++) {
        const length = tokens.lengths[token]!
        const color = tokens.colors[tokens.colorIds[token]!]
        result.push({
            content: content.slice(offset, offset + length),
            color: color || undefined,
        })
        offset += length
    }
    // The block was built from the same line text; anything else is stale.
    return offset === content.length ? result : undefined
}

export function getTokenCacheStats(): {
    entries: number
    keyChars: number
    maxEntries: number
    maxKeyChars: number
} {
    return {
        entries: tokenCache.size,
        keyChars: tokenCacheKeyChars,
        maxEntries: MAX_TOKEN_CACHE_ENTRIES,
        maxKeyChars: MAX_TOKEN_CACHE_KEY_CHARS,
    }
}

// Pending tokenization requests to avoid duplicates
const pendingRequests = new Set<string>()
registerBenchmarkState(() => ({
    syntaxReady: highlighterReady(),
    syntaxPending: pendingRequests.size,
}))

// Request ID counter
let requestId = 0

// Worker instance
let worker: Worker | null = null

// Map request IDs to cache keys for when responses come back
const requestToCacheKey = new Map<number, string>()

function getCacheKey(
    content: string,
    language: SupportedLanguages,
    theme: SyntaxThemeName,
): string {
    return `${theme}:${language}:${content}`
}

function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
    const msg = event.data

    switch (msg.type) {
        case "ready":
            setHighlighterReady(true)
            break

        case "tokens": {
            const cacheKey = requestToCacheKey.get(msg.id)
            if (cacheKey) {
                setCachedTokens(cacheKey, msg.tokens)
                requestToCacheKey.delete(msg.id)
                pendingRequests.delete(cacheKey)
                // Trigger re-render by incrementing version
                setTokenVersion((v) => v + 1)
            }
            break
        }

        case "block-tokens": {
            const cacheKey = requestToCacheKey.get(msg.id)
            if (cacheKey) {
                setCachedBlock(cacheKey, msg)
                requestToCacheKey.delete(msg.id)
                pendingRequests.delete(cacheKey)
                setTokenVersion((v) => v + 1)
            }
            break
        }

        case "error": {
            const cacheKey = requestToCacheKey.get(msg.id)
            if (cacheKey) {
                requestToCacheKey.delete(msg.id)
                pendingRequests.delete(cacheKey)
            }
            break
        }
    }
}

export function initHighlighter(): void {
    if (worker) return

    // Create worker using Bun's worker support
    try {
        const isBundled = import.meta.url.includes("/$bunfs/")
        const workerPaths = isBundled
            ? ["./diff/syntax-worker.js", "./src/diff/syntax-worker.js", "./syntax-worker.js"]
            : ["./syntax-worker.ts"]
        let workerSpec: string | null = null
        for (const workerPath of workerPaths) {
            try {
                workerSpec =
                    import.meta.resolve?.(workerPath) ?? new URL(workerPath, import.meta.url).href
                break
            } catch {}
        }
        if (!workerSpec) {
            throw new Error("Unable to resolve syntax worker path")
        }
        worker = new Worker(workerSpec, {
            type: "module",
        })
    } catch (error) {
        return
    }

    worker.onmessage = handleWorkerMessage
    worker.onerror = (err) => {
        console.error("Syntax worker error:", err)
    }

    // Tell worker to initialize
    worker.postMessage({ type: "init" } satisfies WorkerRequest)
}

export function getLanguage(filename: string): SupportedLanguages {
    return getFiletypeFromFileName(filename)
}

/**
 * Request tokenization from worker.
 * Returns immediately - tokens will arrive async and trigger re-render via tokenVersion signal.
 */
function requestTokenization(
    content: string,
    language: SupportedLanguages,
    theme: SyntaxThemeName,
    cacheKey: string,
): void {
    if (!worker || pendingRequests.has(cacheKey)) return

    pendingRequests.add(cacheKey)
    const id = requestId++
    requestToCacheKey.set(id, cacheKey)

    worker.postMessage({
        type: "tokenize",
        id,
        content,
        language,
        theme,
    } satisfies WorkerRequest)
}

/**
 * Get tokens for a line synchronously.
 * Returns cached tokens if available, otherwise returns plain text and queues tokenization.
 * Components should depend on tokenVersion() to re-render when new tokens arrive.
 */
export function tokenizeLineSync(
    content: string,
    language: SupportedLanguages,
    theme: SyntaxThemeName,
): SyntaxToken[] {
    if (content.length > MAX_HIGHLIGHT_LINE_LENGTH) return [{ content }]
    const cacheKey = getCacheKey(content, language, theme)

    // Check cache first
    const cached = getCachedTokens(cacheKey)
    if (cached) {
        return cached
    }

    // If highlighter ready, request tokenization from worker
    if (highlighterReady()) {
        requestTokenization(content, language, theme, cacheKey)
    }

    // Return plain text for now
    return [{ content }]
}

/**
 * Get tokens for a diff line, using its hunk-side block when available so the
 * line is highlighted with the lexer state of the lines above it.
 * Returns plain text and queues the whole block while tokens are pending.
 */
export function tokenizeDiffLineSync(
    content: string,
    ref: SyntaxLineRef | undefined,
    language: SupportedLanguages,
    theme: SyntaxThemeName,
): SyntaxToken[] {
    if (!ref) return tokenizeLineSync(content, language, theme)
    if (content.length > MAX_HIGHLIGHT_LINE_LENGTH) return [{ content }]
    const key = getBlockKey(ref.block, language, theme)
    const cached = blockCache.get(key)
    if (cached) return lineTokensFromBlock(cached, ref.index, content) ?? [{ content }]

    if (highlighterReady() && worker && !pendingRequests.has(key)) {
        pendingRequests.add(key)
        const id = requestId++
        requestToCacheKey.set(id, key)
        worker.postMessage({
            type: "tokenize-block",
            id,
            lines: ref.block.lines,
            language,
            theme,
        } satisfies WorkerRequest)
    }
    return [{ content }]
}

/**
 * Async version - waits for tokenization to complete.
 * Prefer tokenizeLineSync for rendering.
 */
export async function tokenizeLine(
    content: string,
    language: SupportedLanguages,
    theme: SyntaxThemeName,
): Promise<SyntaxToken[]> {
    if (content.length > MAX_HIGHLIGHT_LINE_LENGTH) return [{ content }]
    const cacheKey = getCacheKey(content, language, theme)

    // Check cache first
    const cached = getCachedTokens(cacheKey)
    if (cached) {
        return cached
    }

    // Wait for highlighter to be ready
    if (!highlighterReady()) {
        return [{ content }]
    }

    if (!worker) return [{ content }]
    const w = worker

    // Request and wait for result
    return new Promise((resolve) => {
        const id = requestId++
        requestToCacheKey.set(id, cacheKey)
        pendingRequests.add(cacheKey)

        const cleanup = () => {
            w.removeEventListener("message", handler)
            requestToCacheKey.delete(id)
            pendingRequests.delete(cacheKey)
        }

        // Set up one-time listener for this specific request. Do not wrap
        // worker.onmessage; repeated async calls would otherwise build a chain
        // of handlers that retain old closures.
        const handler = (event: MessageEvent<WorkerResponse>) => {
            const msg = event.data
            if (msg.type === "tokens" && msg.id === id) {
                setCachedTokens(cacheKey, msg.tokens)
                cleanup()
                resolve(msg.tokens)
            } else if (msg.type === "error" && msg.id === id) {
                cleanup()
                resolve([{ content }])
            }
        }

        w.addEventListener("message", handler)
        w.postMessage({
            type: "tokenize",
            id,
            content,
            language,
            theme,
        } satisfies WorkerRequest)
    })
}

export function isHighlighterReady(): boolean {
    return highlighterReady()
}

/**
 * Clear the token cache (useful when changing themes)
 */
export function clearTokenCache(): void {
    tokenCache.clear()
    tokenCacheKeyChars = 0
    blockCache.clear()
    blockCacheTokens = 0
    setTokenVersion((v) => v + 1)
}
