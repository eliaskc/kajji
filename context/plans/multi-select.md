# Multi-Select (Visual Mode)

> Vim-style visual selection for batch operations on commits and bookmarks.

---

## Concept

Enter visual mode with `v`, then navigate with `j`/`k` to extend selection. Perform batch operations on the selected range. Exit with `Escape`.

This applies to:
- **Log panel** — select multiple commits
- **Bookmarks panel** — select multiple bookmarks, or multiple commits when drilled into a bookmark

---

## UX Flow

1. **Normal mode**: Single item selected (current behavior)
2. **Press `v`**: Enter visual mode, anchor at current item
3. **Navigate `j`/`k`**: Selection extends from anchor to cursor (contiguous range)
4. **Perform action**: Execute command on all selected items
5. **`Escape`**: Exit visual mode, return to single selection

### Visual Feedback

- Selected range: same styling as single-item selection (no separate color needed)
- Anchor item: subtle indicator to show where selection started (e.g., underline or marker)
- Status bar: shows "VISUAL" mode indicator + count (e.g., "VISUAL (3 selected)")

---

## Command Compatibility

Commands must declare whether they support multi-select. When in visual mode with N > 1 items:

| Command | Multi-select? | Behavior |
|---------|---------------|----------|
| `s` squash | Yes | Opens target picker → `jj squash --from first::last --into <target>` |
| `r` rebase | Yes | Opens target picker → `jj rebase -r first::last -d <target>` |
| `a` abandon | Yes | Confirmation dialog → abandons all selected |
| `Ctrl+Y` copy | Yes | Copy all change IDs (newline-separated) |
| `d` describe | **No** | Disabled (can't describe multiple) |
| `e` edit | **No** | Disabled (single working copy) |
| `n` new | **No** | Disabled |

### Target Picker Modal

For squash and rebase, instead of inline target selection (like jjui), use a **modal picker**:

```
┌─ Select Target ─────────────────────────────────────────────────┐
│                                                                 │
│  Squash 3 commits into:                                         │
│                                                                 │
│  > ○ abc12345 main: Latest feature                              │
│    ○ def67890 Add documentation                                 │
│    ○ ghi11111 Fix bug in parser                                 │
│    ○ jkl22222 Initial commit                                    │
│                                                                 │
│  [Enter] Confirm    [Escape] Cancel    [j/k] Navigate           │
└─────────────────────────────────────────────────────────────────┘
```

**Why modal instead of inline?**
- jjui's inline selection is confusing (cursor vs selection ambiguity)
- Modal makes the action explicit and reversible
- Can show more context (commit messages, graph)
- Consistent with other modals (describe, abandon confirmation)

### jj Commands

```bash
# Squash range into target
jj squash --from <first>::<last> --into <target>

# Rebase range onto target  
jj rebase -r <first>::<last> -d <target>

# Abandon multiple
jj abandon <id1> <id2> <id3>
```

### Command Registry Extension

```typescript
interface Command {
  // ... existing fields
  multiSelect?: boolean  // Default: false. If true, command works with visual selection.
  needsTarget?: boolean  // If true, opens target picker before executing
}
```

When visual mode is active and N > 1:
- Commands with `multiSelect: false` are dimmed in help modal
- Attempting to invoke them shows brief error or does nothing

---

## Implementation Notes

### State

```typescript
interface VisualModeState {
  active: boolean
  anchor: string | null  // Change ID or bookmark name where v was pressed
  cursor: string | null  // Current position
}

// Derived: selectedItems = range from anchor to cursor (inclusive)
```

### Selection Computation

Since log/bookmarks are ordered lists, selection is always a contiguous range:
```typescript
function getSelectedRange(items: string[], anchor: string, cursor: string): string[] {
  const anchorIdx = items.indexOf(anchor)
  const cursorIdx = items.indexOf(cursor)
  const start = Math.min(anchorIdx, cursorIdx)
  const end = Math.max(anchorIdx, cursorIdx)
  return items.slice(start, end + 1)
}
```

## Edge Cases

- **Empty selection**: If anchor item is deleted/moved, exit visual mode
- **Panel switch**: Exiting panel while in visual mode should exit visual mode
- **Scroll**: Large selections may extend beyond viewport — ensure cursor stays visible

---

## Future Scope

- **File tree multi-select** — mark multiple files for `jj split` operations
- Select all (`V` or `ggVG`)
- **Rebase with options** — modal with `-s` (with descendants), `-b` (whole branch), `-r` (single)

## Not In Scope

- Non-contiguous selection (Space to toggle individual items)
- Mouse drag selection
- Inline target selection (use modal picker instead)

---

## Priority

Medium effort | High impact

Depends on: Core operations being implemented first (need commands to batch)
