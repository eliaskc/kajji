# lazyjuju

> Project tracker — features, plans, and known issues in one place.

---

## Core Viewing

- [x] Log panel — full jj log with ANSI colors, graph symbols, metadata
- [x] Diff viewer — full ANSI color support (difftastic, delta, etc.)
- [x] Two-panel layout — log/bookmarks left, diff/detail right
- [x] Commit header — author, date, timezone, empty status, description
- [ ] Rich commit details — full message + file stats

## Navigation

- [x] `j`/`k` — move selection / scroll
- [x] `Tab` — cycle focus between panels
- [x] `1`/`2`/`3` — jump directly to panel
- [x] `Escape` — back navigation in drill-down views
- [ ] Mouse support — click to focus, scroll, double-click actions

## Bookmarks Panel

- [x] Bookmark list with drill-down navigation
- [x] Bookmark → commit log → file tree (morphing panel pattern)
- [x] File tree with folder collapse/expand
- [x] File status colors (A/M/D)
- [x] Diff view for selected files
- [ ] Bookmark operations — create, delete, rename, move

## Core Operations

- [x] `n` — new change (create new revision on selected commit)
- [x] `e` — edit change (make selected revision the working copy)
- [x] `s` — squash into parent
- [x] `d` — describe change (modal with subject + body, character count, Tab to switch)
- [x] `a` — abandon change (with confirmation modal)
- [x] Command log panel — shows output/errors, scrolls to latest
- [x] `u` — undo with confirmation (shows last operation, y/n to confirm)
- [x] `U` — redo with confirmation

All operations work in both Log panel and Bookmarks commits view.

## Infrastructure

- [x] Keybind system — registry architecture with config support ready
- [x] Command registry — panel/context/type taxonomy
- [x] Focus tracking — hierarchical context system (e.g., `log.revisions.files`) with prefix matching
- [x] Dialog system — modal stack with backdrop, theme-aware overlay
- [x] Theme system — dual-theme support (lazygit, opencode)
- [x] Status bar — context-aware keybinding hints
- [x] Command palette (`?`) — grouped by context hierarchy, fuzzy search, Enter executes
- [ ] Configuration — user config file, theme selection, custom keybinds → [plan](./plans/configuration.md)

## Utilities

- [x] `ctrl+r` — manual refresh (changed from `R` to avoid conflict with restore)
- [x] `Ctrl+Y` — copy selection to clipboard
- [x] Bold working copy indicator
- [x] Auto-hiding scrollbar
- [x] Smart diff loading — debounced + skips reload when content unchanged
- [ ] Auto-refresh — watch filesystem, refresh on changes

## Text Editing (in modals)

- [ ] Copy (`Ctrl+C`)
- [ ] Word navigation (`Alt+arrows`)
- [ ] Word delete (`Alt+backspace/delete`)

Start with describe modal, generalize to all inputs.

## Easy Wins

- [ ] Workspace tab — list and switch between workspaces
- [x] Oplog view — view and navigate operation history
  - [x] Log/Oplog tabs (switch with `[` and `]`)
  - [x] Grouped operation selection (multi-line blocks)
  - [x] `r` to restore to selected operation
  - [x] Auto-scrolling with margin

**Implementation note — styled panel titles for tabs:**
OpenTUI's `<box title="">` only accepts plain strings (passed to Zig renderer). To style parts of the title differently (e.g., highlight active tab), use the sibling overlay pattern:
```tsx
<box position="relative">
  <box position="absolute" top={0} left={2} zIndex={1}>
    <text>
      <span style={{ fg: activeColor }}>[active]</span>
      <span style={{ fg: dimColor }}> | inactive</span>
    </text>
  </box>
  <box border>{children}</box>
</box>
```

**Design idea — `BorderBox` wrapper with corner slots:**
```tsx
<BorderBox
  topLeft={<><span style={{ fg: accent }}>[1]</span>─Log | Oplog</>}
  topRight={<text>3 files</text>}
  bottomLeft={<text>hints</text>}
  bottomRight={<text>100%</text>}
  border
  borderColor={...}
>
  {children}
</BorderBox>
```
Each corner prop accepts `JSX.Element | string`. Internally wraps content in `position="relative"` box with absolutely positioned overlays at each corner. Passes through all standard `<box>` props (border, borderColor, etc.).

## Diff Viewing

- [x] Basic diff display with ANSI colors
- [ ] Layout modes — half-width, full-width, unified
- [ ] Auto-switch based on terminal width
- [ ] Manual toggle keybind (`v` or `+`/`-`)
- [ ] Difftastic integration with correct width

→ [Detailed plan](./plans/diff-viewing.md)

## Multi-Select (Visual Mode)

- [ ] `v` to enter visual mode
- [ ] `j`/`k` extends selection from anchor
- [ ] Batch operations on selected items
- [ ] Works in Log, Bookmarks, and Bookmarks commits view

→ [Detailed plan](./plans/multi-select.md)

## Theme System

- [x] Phase 1: Two themes (lazygit, opencode)
- [ ] Phase 2: Theme switching via command palette or config
- [ ] Phase 3: More themes (tokyonight, catppuccin, gruvbox, nord)

## Release & Distribution

- [ ] bunx / npx execution
- [ ] Homebrew tap
- [ ] npm publishing
- [ ] GitHub Actions release workflow
- [ ] CLI alias — short command like `ljj`, `lj`, or `juju`

→ [Detailed plan](./plans/release-flows.md)

---

## Nice-to-Have

- [ ] Search & filter — `/` to filter log by description/change ID
- [ ] Command mode — `:` to run arbitrary jj commands
- [ ] Git push/fetch — `P` / `f` for remote operations

---

## Known Issues

### Bugs

- Help modal has small visual gap between border and outer edge (OpenTUI quirk)
- Search input in help modal doesn't render visually (filtering works though)
- Keybinds not visible in modals (dimming overlay blocks status bar)
- Spaces not rendering in BorderBox corner overlays

### Performance

- Some lag when navigating commits quickly (diff rendering / ANSI parsing)
- **Fixed:** Oplog lazy loading (initial 50, loads more on scroll near bottom)
- **Fixed:** Diff reload flash, log/bookmarks flash, spinner flash

### UX Polish

- [ ] Log/bookmark panels slightly wider
- [ ] Selected bookmark should match working copy on load
- [ ] Active bookmark indication when navigating
- [x] Remove "Change" prefix from command titles (e.g., "New" not "New change")
- [ ] Hide tab switching `[`/`]` from status bar, add to help modal Navigation section
  - Group with other general nav commands (j/k, ctrl+u/d) that apply across contexts
  - Avoid duplicating commands that appear in multiple contexts
- [x] Command grouping by context hierarchy in help modal (Navigation section for global commands)

### Technical Debt

- Add unit tests for core operations
- Verify all jj errors shown in command log
- Review dialog API patterns — consider consolidating

---

## Future Ideas

Longer-term possibilities, not actively planned:

- Command mode autocomplete
- PR status indicator in bookmark list
- Conflict visualization
- Revset filtering
- Interactive rebase UI
- Large repo optimization (10k+ commits)

---

## GitHub PR Stacking

> "Graphite in a TUI" — stacked PRs with jj's clean model.

**Stack Creation:**
- Select commit, create PRs for all bookmarks between it and main
- Each PR targets the bookmark below it in the stack
- Preview modal shows full stack before creation
- All PRs created as drafts (encourages correct merge order)

**Stack Reconciliation:**
- On fetch, detect merged PRs
- Offer to rebase remaining stack and update PR targets
- Handle mid-stack merges (e.g., #2 merged → #3 now targets #1)
- Preview modal shows proposed changes before execution

**Conflict Handling:**
- jj allows conflicts to persist; show clear warnings
- Block force-push until resolved (or explicit override)

→ [Detailed plan](./plans/github-stacking.md)

---

## Future: PR Review in TUI

Longer-term addition to GitHub integration:

- View PR details, comments, review status
- Add comments, approve, request changes
- See CI status inline

**Prior Art:** [Graphite](https://graphite.dev/), [gh-stack](https://github.com/timothyandrew/gh-stack), [spr](https://github.com/ejoffe/spr)

---

## Reference

- [archive/lazyjj-plan.md](./archive/lazyjj-plan.md) — Original full specification
- [references/](./references/) — Analysis of jjui, lazyjj, opencode patterns
- [plans/](./plans/) — Detailed feature specs
