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
- [ ] Mouse support
  - [ ] Click to focus panels
  - [ ] Scroll wheel in panels
  - [ ] Double-click as primary action (enter file view, drill into commits/files)

## Bookmarks Panel

- [x] Bookmark list with drill-down navigation
- [x] Bookmark → commit log → file tree (morphing panel pattern)
- [x] File tree with folder collapse/expand
- [x] File status colors (A/M/D)
- [x] Diff view for selected files
- [ ] Bookmark operations (Phase 1 — low effort)
  - [ ] `c` — create bookmark at @ (modal for name)
  - [ ] `d` — delete bookmark (confirmation dialog)
  - [ ] `r` — rename bookmark (modal for new name)
  - [ ] `x` — forget bookmark (local only, no remote propagation)
  - [ ] `b` in Log panel — create/set bookmark on selected commit (popup)
- [ ] Bookmark operations (Phase 2 — medium effort)
  - [ ] `m` — move bookmark to different commit (revset picker)
  - [ ] `t`/`T` — track/untrack remote bookmark

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
- [x] Auto-refresh — focus-based + polling (2s interval checking jj op log ID)

## Text Editing (in modals)

- [ ] Copy (`Ctrl+C`)
- [ ] Word navigation (`Alt+arrows`)
- [ ] Word delete (`Alt+backspace/delete`)

Start with describe modal, generalize to all inputs.

## Workspaces

> lazyjuju is a jj power tool, not an agent orchestrator. Agents are just another way commits appear.

**Core Features:**
- [ ] Workspaces tab (`w`) — list all workspaces
- [ ] Status display: name, working copy change ID, description, last modified
- [ ] Color coding: uncommitted (yellow), described (green), conflicts (red)
- [ ] Create workspace modal (`c`) — name + base revision, shows path to copy
- [ ] Operations from workspace view:
  - [ ] Enter → jump log to workspace's working copy
  - [ ] `s` → squash workspace commits into parent
  - [ ] `r` → rebase workspace onto different target
  - [ ] `d` → archive workspace (after integration)

**Agent Integration (bring-your-own):**
- Human creates workspace via lazyjuju or manually
- Human launches agent in workspace directory (opencode, claude code, etc.)
- Human monitors progress in lazyjuju (commits appear via auto-refresh)
- No orchestration layer — just visibility and operations

**Optional: Workspace Briefing**

On workspace creation, offer to copy a snippet for the agent:
```
You're working in a jj workspace called `<name>`.
Your working copy is change `<id>` on top of `<base>`.
When done: run `jj describe -m "your commit message"`
Don't edit commits outside your workspace.
```

## Easy Wins

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
- [ ] Status bar shows "VISUAL (N selected)"
- [ ] Batch operations:
  - [ ] `s` squash — opens target picker, uses `jj squash --from first::last --into <target>`
  - [ ] `r` rebase — opens target picker, uses `jj rebase -r first::last -d <target>`
  - [ ] `a` abandon — confirm dialog, abandons all selected
  - [ ] `Ctrl+Y` copy — copies all change IDs
- [ ] Works in Log, Bookmarks commits view

→ [Detailed plan](./plans/multi-select.md)

## Theme System

- [x] Phase 1: Two themes (lazygit, opencode)
- [ ] Phase 2: Theme switching via command palette or config
- [ ] Phase 3: More themes (tokyonight, catppuccin, gruvbox, nord)

## Interactive Splitting

- [ ] Split mode entry (`S` on commit)
- [ ] File-level Keep/Split marking
- [ ] Hunk-level splitting (split-pane view)
- [ ] Line-level selection (future)

Lazygit-style interactive `jj split` — mark files/hunks to keep in current commit vs. split to new commit. Two-pane view for hunk mode with cursor navigation, Space to move hunks between panes.

→ [Detailed plan](./plans/interactive-splitting.md)

## Release & Distribution

**Phase 1 — npm ecosystem (one publish covers all):**
- [ ] npm/bunx/pnpm/yarn — add `"bin"` entry, publish to npm

**Phase 2 — additional channels:**
- [ ] Homebrew tap — separate repo + formula
- [ ] curl installer — binary builds + install script
- [ ] GitHub Actions release workflow

**Phase 3 — polish:**
- [ ] CLI alias — short command like `ljj`, `lj`, or `juju`
- [ ] Auto-updater with update notification + `lazyjuju update` command

→ [Detailed plan](./plans/release-flows.md)

## Git Remote Operations

- [ ] `f` — git fetch (default remote)
- [ ] `F` — git fetch all remotes
- [ ] `p` — push change + create PR (jj-native, works on any commit)
  - Runs `jj git push --change <selected>` (auto-creates bookmark from change ID)
  - Runs `gh pr create --head <auto-bookmark>`
  - No bookmark naming required — jj handles it
- [ ] `P` — push all tracked bookmarks

**jj-native approach:** Change ID is the identity, bookmark is just transport. No naming ceremony — select commit, press `p`, PR exists.

**Note:** jj's push is safe by default (like `git push --force-with-lease`). No force flag needed.

---

## Nice-to-Have

- [ ] Search & filter — `/` to filter log by description/change ID
- [ ] Command mode — `:` to run arbitrary jj commands

---

## Known Issues

### Bugs

- Help modal has small visual gap between border and outer edge (OpenTUI quirk)
- Search input in help modal doesn't render visually (filtering works though)
- Keybinds not visible in modals (dimming overlay blocks status bar)
- Spaces not rendering in BorderBox corner overlays

### Performance

All major performance issues have been resolved:

- **Fixed:** Large diff rendering (50k+ lines) — PTY streaming + lazy loading → [details](./plans/diff-virtualization.md)
- **Fixed:** Oplog lazy loading (initial 50, loads more on scroll near bottom)
- **Fixed:** Diff reload flash, log/bookmarks flash, spinner flash
- **Fixed:** Large diff lazy loading (initial 500 lines, loads 500 more when scrolling near bottom)

**Benchmarking:**
- `bun test tests/bench/` runs performance benchmarks
- Results written to `bench-results.json` (gitignored)
- Threshold assertions catch major regressions

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
