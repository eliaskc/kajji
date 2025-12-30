# Context Decomposition

**Current**: `sync.tsx` handles everything (log, selection, diff, focus).

## Proposed Split

```
src/context/
├── log.tsx       # commits, loading, error, loadLog()
├── selection.tsx # selectedIndex, selectNext/Prev/First/Last
├── diff.tsx      # diff, diffLoading, diffError, loadDiff()
├── focus.tsx     # focusedPanel, toggleFocus()
└── index.tsx     # Re-exports or combined provider
```

## Why Defer

Current size is manageable (~150 LOC). Split when adding more state (bookmarks, oplog, etc.).

---

**Priority**: Low effort | Medium impact | When adding bookmarks
