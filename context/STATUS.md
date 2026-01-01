# lazyjuju - Current Status

> Last updated: 2026-01-01

## What Works

### Core Viewing

- **Log panel** - Full jj log display with ANSI colors, graph symbols, metadata
- **Diff viewer** - Full ANSI color support (difftastic, delta, etc. all work)
- **Two-panel layout** - Log left, diff/detail right
- **Commit header** - Author, date, timezone, empty status, description

### Navigation

- `j`/`k` - Move selection / scroll
- `Tab` - Switch focus between panels
- `1`/`2`/`3` - Jump directly to panel
- `Escape` - Back navigation in drill-down views

### Bookmarks Panel

- Bookmark list with drill-down navigation
- Bookmark -> commit log -> file tree (morphing panel pattern)
- File tree with folder collapse/expand
- File status colors (A/M/D)
- Diff view for selected files

### Infrastructure

- **Keybind system** - Registry architecture with config support ready
- **Command registry** - Commands register with metadata (id, title, keybind, context, category)
- **Dialog system** - Modal stack with backdrop, theme-aware overlay opacity
- **Theme system** - Dual-theme support with hardcoded toggle:
  - **lazygit theme**: Green accent, rounded borders, `•` separator, adapts to terminal background
  - **opencode theme**: Peach accent, single borders, gap-based spacing, fixed dark background
  - Themed scrollbars (track/thumb colors)
  - Panel component with theme-aware borders
- **Status bar** - Context-sensitive keybinding hints, theme-aware separator
- **Help modal** (`?`) - Auto-generated from command registry, searchable, responsive columns

### Utilities

- `R` - Manual refresh
- `Ctrl+Y` - Copy selection to clipboard
- Bold working copy indicator
- Auto-hiding scrollbar
- Debounced diff loading (smooth fast navigation)

---

## Known Issues

### Bugs

- **Diff doesn't update on panel focus change** - When viewing a diff from bookmarks panel (commit or file), switching focus back to log panel doesn't update the diff to show the log's selected commit. Diff should reflect the focused panel's selection.
- Help modal has small visual gap between border and outer edge (OpenTUI quirk)
- Search input in help modal doesn't render visually (filtering works though)

### Performance

- Noticeable lag when navigating commits in bookmarks tab
  - Likely culprit: diff rendering and/or ANSI parsing
  - Needs profiling

### UX Polish Needed

- `?` should toggle (also close) the help modal
- Log and bookmark panels could be slightly wider

---

## Not Yet Implemented

See [ROADMAP.md](./ROADMAP.md) for planned features and priorities.

**Quick summary of major missing pieces:**

- Core operations (new, edit, describe, squash, abandon)
- Command mode (`:`)
- Search/filter (`/`)
- GitHub integration
- Mouse support
