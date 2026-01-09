# Pierre Diffs Syntax Highlighting Approach

Source: @pierre/diffs (pierrecomputer/pierre on GitHub)

## Key Findings

Pierre uses Shiki but with several performance optimizations we're not using.

## Architecture

### 1. Streaming Tokenization

`ShikiStreamTokenizer` class splits code into lines and tokenizes incrementally:
- Maintains **stable** (complete) and **unstable** (incomplete) token buffers
- Preserves `GrammarState` between lines for multi-line constructs
- Wrapped in `CodeToTokenTransformStream` for Web Streams API compatibility

### 2. Shiki 3.0 Configuration

```typescript
// Uses JavaScript regex engine (no WASM overhead)
createJavaScriptRegexEngine()

// Key optimization: skip very long lines
codeToHast(code, {
  tokenizeMaxLineLength: 1000
})
```

### 3. Lazy Loading

Languages and themes are loaded lazily and in parallel:
```typescript
// Only load what's needed, when it's needed
await highlighter.loadLanguage(language)
```

### 4. Worker Pool for Performance

`WorkerPoolManager` distributes rendering across Web Workers:
- Uses `createHighlighterCoreSync()` in workers for synchronous highlighting
- LRU caching (default 100 items) with `cacheKey` to avoid re-rendering
- Task queue for load balancing when all workers are busy

### 5. Diff-Specific Highlighting

Uses the `diff` library (`diffChars`, `diffWordsWithSpace`) for line-level changes:
- Converts diff results into Shiki decorations
- Applies decorations via `codeToHast()` config to highlight changed content

## Key Optimizations We're Missing

| Optimization | Pierre | Kajji |
|--------------|--------|-------|
| `tokenizeMaxLineLength` | 1000 chars | None (tokenizes everything) |
| Worker pool | Yes | No (main thread) |
| Streaming tokenization | Yes | No (full lines) |
| JavaScript regex engine | Explicit | Default |
| LRU cache | 100 items | 500 items |

## Recommendations for Kajji

1. **Add `tokenizeMaxLineLength`** - Skip syntax for lines > 500-1000 chars
2. **Consider worker pool** - Offload to web workers for true non-blocking
3. **Streaming for large diffs** - Don't tokenize entire file at once
4. **Explicit JS regex engine** - Might help with JIT warmup
