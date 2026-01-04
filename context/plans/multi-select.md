# Multi-Select (Visual Mode)

> Vim-style visual selection for batch operations on commits and bookmarks.

---

## Concept

Enter visual mode with `v`, then navigate with `j`/`k` to extend selection. Perform batch operations on the selected range. Exit with `Escape`.

This applies to:
- **Log panel** — select multiple commits
- **Bookmarks panel** — select multiple bookmarks, or multiple commits when drilled into a bookmark

---

## Selection Modes

### Contiguous Mode (Default)

For operations requiring ancestry chain: **stack creation, rebase, squash**.

**Behavior:**
- Selection must be contiguous in ancestry
- Invalid selections are **dimmed** — commits that would break the chain are visually de-emphasized
- As you extend selection, dimming updates in real-time

**Visual feedback:**
```
  ○ abc12345 feature: add auth     ← selectable (ancestor of selection)
  ● def67890 fix: validation bug   ← SELECTED (anchor)
  ● ghi11111 refactor: cleanup     ← SELECTED (cursor)
  ○ jkl22222 docs: update readme   ← selectable (descendant of selection)
  ◌ mno33333 unrelated branch      ← DIMMED (not in ancestry chain)
  ◌ pqr44444 another branch        ← DIMMED
```

**Operations using contiguous mode:**
| Command | Action |
|---------|--------|
| `c` / `P` | Create PR stack |
| `s` | Squash into target |
| `r` | Rebase onto target |

### Free Mode

For operations that work on any set of commits.

**Behavior:**
- Any commits can be selected
- No dimming — all commits are valid targets
- Selection still extends contiguously from anchor to cursor (vim visual line behavior)

**Operations using free mode:**
| Command | Action |
|---------|--------|
| `a` | Abandon all selected |
| `Ctrl+Y` | Copy all change IDs |

### Mode Selection

`v` enters **contiguous mode** by default. This is the more common use case (stack creation, rebase, squash).

For operations that need free mode (abandon, copy), contiguous mode still works — you just can't select non-contiguous commits. This is acceptable because:
- Abandoning a contiguous range is the common case
- Copying a contiguous range is the common case
- If you need true non-contiguous selection, see "Alternative: Toggle Selection" below

---

## UX Flow

1. **Normal mode**: Single item selected (current behavior)
2. **Press `v`**: Enter visual mode, anchor at current item
3. **Navigate `j`/`k`**: Selection extends from anchor to cursor
   - In contiguous mode: invalid items are dimmed, cursor skips them
4. **Perform action**: Execute command on all selected items
5. **`Escape`**: Exit visual mode, return to single selection

### Visual Feedback

- Selected range: highlighted background (same as single-item selection, but spanning multiple)
- Anchor item: subtle indicator (e.g., underline or `>` marker)
- Dimmed items (contiguous mode): reduced opacity or muted colors
- Status bar: shows mode + count (e.g., "VISUAL (3 selected)" or "VISUAL-CONTIGUOUS (3)")

---

## Command Compatibility

Commands must declare whether they support multi-select and which mode they require.

| Command | Multi-select? | Mode | Behavior |
|---------|---------------|------|----------|
| `c` / `P` stack | Yes | Contiguous | Opens stack editor → creates PR stack |
| `s` squash | Yes | Contiguous | Opens target picker → `jj squash --from first::last --into <target>` |
| `r` rebase | Yes | Contiguous | Opens target picker → `jj rebase -r first::last -d <target>` |
| `a` abandon | Yes | Free | Confirmation dialog → abandons all selected |
| `Ctrl+Y` copy | Yes | Free | Copy all change IDs (newline-separated) |
| `d` describe | **No** | — | Disabled (can't describe multiple) |
| `e` edit | **No** | — | Disabled (single working copy) |
| `n` new | **No** | — | Disabled |

### Target Picker Modal

For squash and rebase, use a **modal picker**:

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
  multiSelect?: boolean       // Default: false. If true, command works with visual selection.
  multiSelectMode?: 'contiguous' | 'free'  // Which mode this command requires
  needsTarget?: boolean       // If true, opens target picker before executing
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
  mode: 'contiguous' | 'free'
  anchor: string | null  // Change ID where v was pressed
  cursor: string | null  // Current position
}

// Derived: selectedItems = range from anchor to cursor (inclusive)
// Derived: dimmedItems = items not in valid selection range (contiguous mode only)
```

### Selection Computation

```typescript
function getSelectedRange(items: string[], anchor: string, cursor: string): string[] {
  const anchorIdx = items.indexOf(anchor)
  const cursorIdx = items.indexOf(cursor)
  const start = Math.min(anchorIdx, cursorIdx)
  const end = Math.max(anchorIdx, cursorIdx)
  return items.slice(start, end + 1)
}

function getDimmedItems(
  items: string[], 
  anchor: string, 
  ancestryChain: Set<string>
): string[] {
  // In contiguous mode, dim items not in the ancestry chain of the anchor
  return items.filter(item => !ancestryChain.has(item))
}
```

### Ancestry Chain Computation

For contiguous mode, we need to know which commits are valid selections:

```typescript
// Get all commits in ancestry chain (ancestors + descendants) of anchor
function getAncestryChain(anchor: string): Set<string> {
  // Use jj log with revset: ancestors(anchor) | descendants(anchor)
  // Or compute from already-loaded log data if we have parent info
}
```

---

## Edge Cases

- **Empty selection**: If anchor item is deleted/moved, exit visual mode
- **Panel switch**: Exiting panel while in visual mode should exit visual mode
- **Scroll**: Large selections may extend beyond viewport — ensure cursor stays visible
- **Dimmed navigation**: In contiguous mode, `j`/`k` should skip dimmed items (or jump to next valid item)

---

## Alternative: Toggle Selection (jjui style)

jjui uses `Space` to toggle selection on individual items, rather than vim-style visual mode.

**How it works:**
- Normal navigation with `j`/`k`
- `Space` toggles current item's selection state
- Can select non-contiguous items freely
- Operation applies to all toggled items

**Pros:**
- More flexible — can select any combination
- Familiar to some users (file managers, etc.)
- No "mode" to enter/exit

**Cons:**
- More keystrokes for contiguous ranges (must toggle each item)
- Less vim-like (kajji's general UX is vim-inspired)
- No visual "anchor to cursor" range extension
- Harder to integrate with stack creation (which requires contiguous)

**Current decision:** Visual mode (vim-style) is preferred for kajji's UX consistency. Toggle selection noted as alternative but not planned.

---

## Future Scope

- **File tree multi-select** — mark multiple files for `jj split` operations
- **Select all** (`V` or `ggVG`)
- **Rebase with options** — modal with `-s` (with descendants), `-b` (whole branch), `-r` (single)
- **Mode toggle** — if needed, add a way to switch between contiguous and free mode mid-selection

## Not In Scope

- Non-contiguous selection via toggle (Space) — see alternative above
- Mouse drag selection
- Inline target selection (use modal picker instead)

---

## Priority

Medium effort | High impact

Depends on: Core operations being implemented first (need commands to batch)

Enables: Stack creation flow (uses contiguous multi-select)
