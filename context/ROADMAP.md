# lazyjuju - Roadmap

> Features and improvements planned for implementation.
>
> For current state, see [STATUS.md](./STATUS.md).

---

## Priorities

### High Priority

| Area | Description | Plan |
|------|-------------|------|
| ~~**Core Operations**~~ | ~~`new`, `edit`, `describe`, `squash`, `abandon`~~ | ✅ Done |
| **Undo/Redo** | `u` / `Ctrl+r` with confirmation - CRITICAL safety feature | — |
| **Performance** | Profile and fix lag in bookmarks navigation | [Details below](#performance-investigation) |
| **Mouse Support** | Click to focus, scroll, double-click actions | — |
| **Configuration** | User config file, theme selection, custom keybinds | [plans/configuration.md](./plans/configuration.md) |

### Easy Wins (Soon)

| Area | Description | Plan |
|------|-------------|------|
| **Text Editing** | Copy (Ctrl+C in modals), word nav (Alt+arrows), word delete (Alt+backspace/delete) | Start with describe modal, generalize to all inputs |
| **Bookmark Operations** | Create, delete, rename, move bookmarks | — |
| **Workspace Tab** | List and switch between workspaces | — |
| **Oplog View** | View and restore from operation history | — |

### Medium Priority

| Area | Description | Plan |
|------|-------------|------|
| **Diff Viewing** | Side-by-side, layout modes, difftastic integration | [plans/diff-viewing.md](./plans/diff-viewing.md) |
| **Release Flows** | bunx, Homebrew, npm publishing | [plans/release-flows.md](./plans/release-flows.md) |
| **Multi-Select** | Visual mode (`v`) for batch operations on commits/bookmarks | [plans/multi-select.md](./plans/multi-select.md) |
| **Auto-Refresh** | Watch filesystem, refresh on changes | — |

### Nice-to-Have

| Area | Description |
|------|-------------|
| Search & Filter | `/` to filter log by description/change ID |
| Command Mode | `:` to run arbitrary jj commands |
| Git Push/Fetch | `P` / `f` for remote operations |

---

## Core Operations

> ✅ **Done** - All core operations implemented with command log panel.

The essential jj operations to make lazyjuju useful for daily work.

| Key | Operation | Behavior |
|-----|-----------|----------|
| `n` | `jj new` | Create new change. No confirmation. |
| `e` | `jj edit` | Edit selected change. No confirmation. |
| `d` | `jj describe` | Opens describe modal. |
| `s` | `jj squash` | Squash into parent. No confirmation. |
| `a` | `jj abandon` | Abandon change. **Requires confirmation.** |

### Describe Modal

```
┌─ Describe ─────────────────────────── Enter: save | Esc: cancel ─┐
│ ┌─ Subject ─────────────────────────────────────────────────────┐ │
│ │ feat: add new feature                                         │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ ┌─ Body ────────────────────────────────────────────────────────┐ │
│ │                                                               │ │
│ └───────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

- Pre-fills with existing description
- Tab switches between subject and body
- Enter in subject saves, Enter in body is newline

### Confirmation Modal

For destructive operations (abandon, undo):
- Show commit description
- `y` or Enter = confirm
- `n` or Escape = cancel

---

## Performance Investigation

Some lag when navigating commits quickly.

**Fixed:**
- ✅ Diff reload on focus switch — now skips if content unchanged (major perceived lag reduction)

**Remaining suspected causes:**
- Diff rendering (ANSI parsing via ghostty-opentui)
- Frequent re-renders during navigation

**Investigation steps:**
1. Profile with `bun --inspect` or console timing
2. Identify hot paths (ANSI parsing? rendering?)
3. Consider: memoization, virtualization, or async loading patterns

**Success criteria:** Navigation feels instant (<50ms perceived lag)

---

## Command Palette

> ✅ **Done** - Help modal (`?`) now functions as command palette

- Shows all commands grouped by panel (Log, Bookmarks, Diff, Global)
- Fuzzy search filters commands
- Enter executes selected command
- Inactive commands dimmed based on current context
- j/k or arrow keys to navigate

---

## Theme System

### ✅ Phase 1: Two Themes (Done)

- lazygit theme (green accent, rounded borders)
- opencode theme (peach accent, single borders)
- Hardcoded toggle in code

### Phase 2: Theme Switching

- Command palette or config to switch themes
- Persist selection

### Phase 3: More Themes

- Popular themes: tokyonight, catppuccin, gruvbox, nord
- Custom theme loading from config

---

## UI Polish

Quick wins:

- [x] `?` should toggle (also close) help modal
- [x] Context-aware keybinds with panel/context/type taxonomy
- [x] Help modal groups by panel, dims inactive commands
- [x] Command palette (help modal with Enter-to-execute)
- [ ] Log/bookmark panels slightly wider
- [ ] Rich commit details (full message + file stats)

---

## Future Ideas

Longer-term possibilities, not planned for near-term:

- Command mode autocomplete
- PR status indicator in bookmark list
- Conflict visualization
- Revset filtering
- ~~Multi-select for batch operations~~ → moved to Medium Priority
- Interactive rebase UI
- Large repo optimization (10k+ commits)

---

## Dream State: GitHub PR Integration

> Aspirational feature requiring significant work. Think "Graphite in a TUI."

### PR Review Workflow
- View PR details, comments, and review status in TUI
- Add comments, approve, request changes without leaving terminal
- See CI status and checks inline

### Stacked PRs Management
- Visualize PR stack (parent/child relationships)
- Rebase entire stack with single command
- Auto-update dependent PRs when base changes
- Sync with GitHub's stacked PR support (when available)

### Why This Matters
jj's first-class support for stacked changes makes it natural for stacked PRs, but managing them on GitHub is painful. A TUI that understands both jj's change graph AND GitHub's PR model could be transformative.

### Prior Art
- [Graphite](https://graphite.dev/) — Stacked PRs workflow (CLI + web)
- [gh-stack](https://github.com/timothyandrew/gh-stack) — CLI for stacked PRs
- [spr](https://github.com/ejoffe/spr) — Stacked PRs for GitHub

---

## Reference

- [STATUS.md](./STATUS.md) — Current state, what works, known issues
- [archive/lazyjj-plan.md](./archive/lazyjj-plan.md) — Original full specification
- [references/](./references/) — Analysis of jjui, lazyjj, opencode patterns
