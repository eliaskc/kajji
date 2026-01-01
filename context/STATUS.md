# lazyjuju - Current Status

> Last updated: 2026-01-02

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
- **Command registry** - Panel/context/type taxonomy:
  - `context`: global, commits, bookmarks, files, diff, help
  - `type`: action, navigation, view
  - `panel`: optional scoping to prevent conflicts (log, bookmarks, diff)
  - `hidden`: omit from help and status bar (navigation commands like j/k)
- **Focus tracking** - `activeContext` updates based on panel + view mode
- **Dialog system** - Modal stack with backdrop, theme-aware overlay opacity
- **Theme system** - Dual-theme support with hardcoded toggle:
  - **lazygit theme**: Green accent, rounded borders, `•` separator, adapts to terminal background
  - **opencode theme**: Peach accent, single borders, gap-based spacing, fixed dark background
  - Themed scrollbars (track/thumb colors)
  - Panel component with theme-aware borders
- **Status bar** - Context-aware keybinding hints filtered by active context + panel
- **Command palette** (`?`) - Grouped by panel, fuzzy search, Enter executes, inactive commands dimmed

### Core Operations

- `n` - New change (create new revision on selected commit)
- `e` - Edit change (make selected revision the working copy)
- `s` - Squash into parent
- `d` - Describe change (modal with subject + body fields, character count, Tab to switch)
- `a` - Abandon change (with confirmation modal)
- **Command log panel** - Shows output/errors from operations, scrolls to latest

All operations work in both Log panel and Bookmarks commits view.

### Utilities

- `R` - Manual refresh
- `Ctrl+Y` - Copy selection to clipboard
- Bold working copy indicator
- Auto-hiding scrollbar
- Smart diff loading - debounced + skips reload when content unchanged (no flash on focus switch)

---

## Known Issues

### Bugs

- Help modal has small visual gap between border and outer edge (OpenTUI quirk)
- Search input in help modal doesn't render visually (filtering works though)
- Keybinds not visible in modals (dimming overlay blocks status bar) - need alternative display method

### Performance

- ~~Flashing when switching focus between panels~~ Fixed: skip diff reload if content unchanged
- Some lag when navigating commits quickly (diff rendering / ANSI parsing)
  - See [ROADMAP.md#performance-investigation](./ROADMAP.md#performance-investigation) for investigation plan

### UX Polish Needed

- Log and bookmark panels could be slightly wider
- Selected bookmark should match working copy on load (or closest parent if no exact match)
- Active bookmark indication when navigating (vs just focused item)

---

## Technical Debt & TODOs

- Add unit tests for core operations (mock executor, test --ignore-immutable flag passing, isImmutableError detection)
- Verify all jj errors are shown in command log (currently only operation errors - check if others slip through)
- Review dialog API usage patterns - consider consolidating repeated confirm/modal patterns
- Dialog system: Promise-based `dialog.confirm()` works well, consider similar for other modals

## Not Yet Implemented

See [ROADMAP.md](./ROADMAP.md) for planned features and priorities.

**Quick summary of major missing pieces:**

- Command mode (`:`)
- Search/filter (`/`)
- GitHub integration
- Mouse support
- Configuration (user config file, theme switching)
