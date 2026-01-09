# OpenTUI Syntax Highlighting Approach

Source: sst/opentui on GitHub

## Key Finding: They Don't Use Shiki

OpenTUI uses **Tree-Sitter in a Web Worker** instead of Shiki. This is fundamentally different from our approach.

## Architecture

### 1. Worker-Based Tree-Sitter

The `TreeSitterClient` uses a Web Worker for all parsing:

```typescript
// packages/core/src/lib/tree-sitter/client.ts
public async highlightOnce(
  content: string,
  filetype: string,
): Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> {
  const messageId = `oneshot_${this.messageIdCounter++}`
  return new Promise((resolve) => {
    this.messageCallbacks.set(messageId, resolve)
    this.worker?.postMessage({
      type: "ONESHOT_HIGHLIGHT",
      content,
      filetype,
      messageId,
    })
  })
}
```

### 2. Async Highlighting with Snapshot IDs

The `CodeRenderable` component delegates highlighting to a Web Worker:

```typescript
// packages/core/src/renderables/Code.ts
private async startHighlight(): Promise<void> {
  const snapshotId = ++this._highlightSnapshotId

  this._isHighlighting = true

  try {
    const result = await this._treeSitterClient.highlightOnce(content, filetype)

    // Check if this result is still relevant
    if (snapshotId !== this._highlightSnapshotId) {
      return // Discard stale result
    }

    // Apply highlighting...
  } catch (error) {
    // Graceful fallback to plain text
    this.textBuffer.setText(content)
  }
}
```

### 3. Lazy Rendering During Highlighting

Shows unstyled text while highlighting is in progress:

```typescript
protected renderSelf(buffer: OptimizedBuffer): void {
  if (this._highlightsDirty) {
    // Show unstyled text immediately while highlighting happens async
    this.ensureVisibleTextBeforeHighlight()
    this._highlightsDirty = false
    this.startHighlight() // Fire and forget - doesn't await
  }
}
```

### 4. Diff Component Waits for Alignment

The `DiffRenderable` waits for highlighting to complete before aligning split-view columns:

```typescript
// packages/core/src/renderables/Diff.ts
private handleLineInfoChange = (): void => {
  if (!this._waitingForHighlight) return

  const leftIsHighlighting = this.leftCodeRenderable.isHighlighting
  const rightIsHighlighting = this.rightCodeRenderable.isHighlighting

  if (!leftIsHighlighting && !rightIsHighlighting) {
    this._waitingForHighlight = false
    this.requestRebuild() // Rebuild with proper alignment after highlighting
  }
}
```

## Key Patterns

| Pattern | Purpose | Implementation |
|---------|---------|----------------|
| **Worker Thread** | Offload parsing to background | `TreeSitterClient` with Web Worker |
| **Snapshot IDs** | Prevent stale updates | Increment on content change, check before applying |
| **Lazy Rendering** | Show text immediately | `ensureVisibleTextBeforeHighlight()` renders unstyled text first |
| **Event Listeners** | Wait for async completion | `line-info-change` event emitted when highlighting finishes |
| **Graceful Fallback** | Handle errors | Catch highlighting errors, fall back to plain text |
| **Debouncing** | Avoid excessive work | `DebounceController` in TreeSitterClient |

## Why This Matters for Kajji

Tree-Sitter advantages over Shiki:
1. **Incremental parsing** - Can parse diffs without full re-parse
2. **WASM in worker** - True non-blocking
3. **No network requests** - Queries bundled with the app
4. **No JIT warmup issues** - WASM is pre-compiled

Tradeoffs:
- More complex setup (WASM, workers)
- Need to manage language grammars
- Different highlighting quality (grammar-based vs regex-based)
