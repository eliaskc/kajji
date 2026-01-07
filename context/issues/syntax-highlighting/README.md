# Syntax Highlighting Performance Issue

**STATUS: PARTIALLY WORKING** - Worker implementation works, `on()` helper improves reactivity but still inconsistent

## Problem Summary

1. **Original issue**: Shiki JIT warmup caused 1-2s hangs on navigation
2. **Fixed**: Worker-based architecture eliminates startup delay
3. **Remaining**: Syntax doesn't appear until user scrolls (reactivity issue)

## What Works

### Worker-Based Architecture
- Startup is now instant (no JIT blocking main thread)
- Tokenization happens in background worker
- Worker warms up Shiki independently

### Architecture
```
Main Thread                          Worker Thread
───────────                          ─────────────
scheduler.prefetch() ──────────────► Worker receives tokenize request
     │                                    │
     │                                    ▼
     │                               Shiki tokenizes (JIT warmup here)
     │                                    │
     ◄─────────────────────────────── Worker posts tokens back
     │
     ▼
setTokenStore() + setVersion()
     │
     ▼
createEffect should re-run... but doesn't reliably
```

## What Doesn't Work

### Solid Reactivity Issue
Components don't re-render when tokens arrive. Tried multiple approaches:

#### Attempt 1: createMemo with store access
```tsx
const tokens = createMemo(() => {
  const cached = scheduler.store[key]
  return cached ?? defaultTokens
})
```
**Result**: Memo doesn't re-run when store updates

#### Attempt 2: Version signal
```tsx
const [version, setVersion] = createSignal(0)
// In scheduler: setVersion(v => v + 1) after store update

const tokens = createMemo(() => {
  scheduler.version()  // Track version changes
  const cached = scheduler.store[key]
  return cached ?? defaultTokens
})
```
**Result**: Still doesn't re-run reliably

#### Attempt 3: createEffect with local signal
```tsx
const [tokens, setTokens] = createSignal(defaultTokens)

createEffect(() => {
  scheduler.version()
  const cached = scheduler.store[key]
  if (cached) setTokens(cached)
})
```
**Result**: Effect runs once on mount, doesn't re-run when version changes

#### Attempt 4: Queue requests until worker ready
```tsx
if (workerReady) {
  doPrefetch()
} else {
  queuedPrefetches.push(doPrefetch)
}
```
**Result**: Requests are queued and processed, but UI still doesn't update

#### Attempt 5: createMemo with on() helper
```tsx
const tokens = createMemo(
  on(
    () => scheduler?.version() ?? 0,  // Explicit dependency
    () => {
      const cached = scheduler?.store[key]
      return cached ?? defaultTokens
    },
    { defer: false }
  )
)
```
**Result**: Works sometimes, inconsistent. Better than previous attempts but not reliable.

### Why Scroll "Fixes" It
When user scrolls:
1. `visibleRows()` changes
2. Some row components are destroyed/recreated
3. New components mount and render with already-cached tokens
4. Pre-existing components still don't update

## Theories

### Theory 1: Solid tracking issue with dynamic store keys
When accessing `store[dynamicKey]` where key doesn't exist initially, Solid might not properly track for future additions.

### Theory 2: Virtualization interference
The `<For>` component with virtualization might be preventing reactive updates to existing items.

### Theory 3: Batch timing
Updates happen in `batch()` which might be deferring signals in a way that breaks the reactive chain.

## Files Changed

- `src/diff/syntax-worker.ts` - NEW: Worker with Shiki init and tokenization
- `src/diff/syntax-scheduler.ts` - Uses worker, queues until ready
- `src/diff/syntax.ts` - Stub functions (worker handles everything)
- `src/components/diff/VirtualizedUnifiedView.tsx` - createEffect pattern
- `src/components/diff/VirtualizedSplitView.tsx` - createEffect pattern

## Warmup Strategy Rethink

The 2s warmup is a poor tradeoff. It "fixes" 600ms hangs on some commits by making the first commit **always** lack syntax highlighting for 2+ seconds. That's arguably worse UX.

**Alternative approaches:**

1. **Accept occasional lag** — Remove warmup entirely. JIT compilation happens naturally on first few tokenizations. Most commits are fast; occasional 500ms lag is acceptable.

2. **One worker per commit** — When user navigates to a commit, spawn a dedicated worker to tokenize that commit's diff. 600ms pre-fetch is acceptable if it happens in background. No warmup needed — JIT happens naturally during the pre-fetch.

3. **Debounce with eager pre-fetch** — When navigating quickly through commits (j/k spam), still fetch tokens in background for each commit, but don't trigger UI updates until debounce timer ends. When user stops on a commit, tokens are already ready. This prevents syntax highlighting from "lagging behind" during fast navigation.

4. **Predictive pre-fetch** — When app starts, identify the commit that will be shown first (current working copy). Start tokenizing its diff in background immediately, before UI even renders.

**Key insight:** The goal isn't "avoid all JIT lag" — it's "have tokens ready when user looks at the diff." Pre-fetching solves this without blocking startup or causing visible lag.

## Ideas to Try

### Option A: Force re-render on worker message
Instead of relying on reactive store, use a more imperative approach:
```tsx
worker.onmessage = () => {
  // Directly trigger component re-render somehow
  // Maybe invalidate the entire diff view?
}
```

### Option B: Use createResource
Solid's `createResource` is designed for async data. Might handle this better:
```tsx
const [tokens] = createResource(key, async (k) => {
  await waitForTokens(k)
  return scheduler.store[k]
})
```

### Option C: Abandon fine-grained reactivity
Tokenize entire visible viewport at once, re-render whole diff when done:
```tsx
const [allTokens, setAllTokens] = createSignal<Map<string, Token[]>>()

worker.onmessage = (batch) => {
  setAllTokens(new Map([...allTokens(), ...batch]))
}
```

### Option D: Switch to Tree-Sitter
OpenTUI uses Tree-Sitter in a worker with explicit re-render triggers. Different architecture that might avoid these issues entirely.

### Option E: Investigate OpenTUI's pattern more deeply
They use snapshot IDs and explicit `requestRebuild()` calls. Not pure reactivity.

## Performance Results

| Metric | Before | After Worker |
|--------|--------|--------------|
| Startup | ~2.2s | ~100ms |
| Navigation | 5-15ms | 5-15ms |
| Syntax appears | On scroll only | On scroll only |

## Debug Observations

When logging was enabled:
- `[Scheduler] batch done` logs appear correctly - tokens ARE being processed
- `[DiffLineRow] effect` logs only appear on initial mount, not on version changes
- Version signal IS incrementing (0 → 1 → 2 → ...)
- Store IS being updated with tokens
- But effects don't re-run

## Related Research

- [research-opentui.md](./research-opentui.md) - Tree-Sitter in workers, explicit rebuilds
- [research-pierre-diffs.md](./research-pierre-diffs.md) - Shiki with worker pools
