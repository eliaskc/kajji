# kajji

> Project tracker — features, plans, and known issues in one place.

---

## Core Viewing

- [x] Log panel — full jj log with ANSI colors, graph symbols, metadata
- [x] Diff viewer — full ANSI color support (difftastic, delta, etc.)
- [x] Two-panel layout — log/bookmarks left, diff/detail right
- [x] Commit header — author, date, timezone, empty status, description
- [ ] Commit header indicators — bookmarks, workspace, git HEAD, remote tracking
- [ ] Rich commit details — full message + file stats

## Navigation

- [x] `j`/`k` — move selection / scroll
- [x] `Tab` — cycle focus between panels
- [x] `1`/`2`/`3` — jump directly to panel
- [x] `Escape` — back navigation in drill-down views
- [x] Mouse support
  - [x] Click to focus panels
  - [x] Click to select items in lists
  - [x] Click folder to toggle expand/collapse
  - [x] Double-click as primary action (enter file view, drill into commits/files, focus diff panel)

## Bookmarks Panel

- [x] Bookmark list with drill-down navigation
- [x] Bookmark → commit log → file tree (morphing panel pattern)
- [x] File tree with folder collapse/expand
- [x] File status colors (A/M/D)
- [x] Diff view for selected files
- [x] Bookmark operations (Phase 1 — low effort)
  - [x] `c` — create bookmark at @ (modal for name)
  - [x] `d` — delete bookmark (confirmation dialog)
  - [x] `r` — rename bookmark (modal for new name)
  - [x] `x` — forget bookmark (local only, no remote propagation)
  - [x] `b` — create bookmark on selected commit (works in Log and Bookmarks commits view)
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
- [x] `r` — restore file/folder in file tree (discard changes, with confirmation)
- [ ] `B` — move bookmark here (in revisions view: pick bookmark to move to selected commit)

All operations work in both Log panel and Bookmarks commits view.

## Copy Menu (lazygit-style)

- [ ] `y` — open copy menu on selected commit
  - [ ] Change ID (short, e.g., `abcd1234`)
  - [ ] Commit ID (full git hash)
  - [ ] Description subject (first line)
  - [ ] Description (full message with body)
  - [ ] Diff (full diff output)
  - [ ] Author
  - [ ] Commit URL (if remote linked, e.g., GitHub permalink)
- [ ] Menu with keyboard shortcuts for each option (like lazygit)
- [ ] Works in Log panel and Bookmarks commits view

## Infrastructure

- [x] Keybind system — registry architecture with config support ready
- [x] Command registry — panel/context/type taxonomy
- [x] Focus tracking — sibling mode system (e.g., `log.revisions`, `log.files`) without inheritance
- [x] Dialog system — modal stack with backdrop, theme-aware overlay
- [x] Theme system — dual-theme support (lazygit, opencode)
- [x] Status bar — exact context match only (shows current mode + globals)
- [x] Command palette (`?`) — semantic grouping (revisions, files, bookmarks), fuzzy search, Enter executes
- [ ] Configuration — user config file, theme selection, custom keybinds → [plan](./plans/configuration.md)
  - [ ] "Open config" command (`help-only` visibility, opens `$EDITOR`, creates default if missing)
- [ ] Startup: detect no jj repo — suggest `jj git init` (if .git found) or show recent jj repos

## Utilities

- [x] `ctrl+r` — manual refresh (changed from `R` to avoid conflict with restore)
- [x] Bold working copy indicator
- [x] Auto-hiding scrollbar
- [x] Smart diff loading — debounced + skips reload when content unchanged
- [x] Auto-refresh — focus-based + polling (2s interval checking jj op log ID)

## Pre-release

Must-do before initial release:

**Status bar cleanup:**
- [x] Add `visibility` field to commands (`all` | `help-only` | `status-only` | `none`)
- [x] Show modal hints in status bar when dialog is open
- [x] Mark navigation commands as `help-only` (j/k, ctrl+u/d, tab, 1/2/3, [/], enter, escape)
- [x] Mark git operations (f/F/p/P) and refresh (ctrl+r) as `help-only`
- [x] Update HelpModal to filter by visibility

**Command log:**
- [x] Click to focus
- [x] Keyboard scroll (j/k, ctrl+u/d)
- [x] Expand height when focused

**Input improvements:**
- [x] Paste (`Ctrl+V` / `Cmd+V`)
- [x] Word navigation (`Alt+arrows`)
- [x] Word delete (`Alt+backspace/delete`)
- [x] Jump to line start/end (`Home`/`End`)

Solved by replacing `<input>` with `<textarea>` using single-line keybindings (Enter→submit instead of newline). Textarea natively supports all text editing features.

**Bugs:**
- [x] Describe modal pre-fill text is garbled/corrupted

## Workspaces

> kajji is a jj power tool, not an agent orchestrator. Agents are just another way commits appear.

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
- Human creates workspace via kajji or manually
- Human launches agent in workspace directory (opencode, claude code, etc.)
- Human monitors progress in kajji (commits appear via auto-refresh)
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

- [ ] `v` to enter visual mode (contiguous mode by default)
- [ ] `j`/`k` extends selection from anchor
- [ ] **Contiguous mode**: invalid selections dimmed (for stack/rebase/squash)
- [ ] **Free mode**: any commits selectable (for abandon/copy)
- [ ] Status bar shows "VISUAL (N selected)"
- [ ] Batch operations:
  - [ ] `c` / `P` stack — opens stack editor (contiguous)
  - [ ] `s` squash — opens target picker (contiguous)
  - [ ] `r` rebase — opens target picker (contiguous)
  - [ ] `a` abandon — confirm dialog (free)
  - [ ] `Ctrl+Y` copy — copies all change IDs (free)
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

## CLI Commands

> What's good for humans is good for agents, and vice versa.

Agent-friendly CLI for operations jj doesn't expose non-interactively. TUI users never need to touch these; CLI users never need to touch the TUI.

**Core commands:**
- [ ] `kajji changes <rev>` — List changes with addressable hunk IDs
- [ ] `kajji split <rev>` — Non-interactive split with hunk selection
- [ ] `kajji stack create <revs>` — Create PR stack from commits
- [ ] `kajji stack list` — List all PR stacks with status
- [ ] `kajji stack sync` — Reconcile stacks after merges
- [ ] `kajji stack show <name>` — Show stack details

**Design principles:**
- `--json` on every command for agent consumption
- `--dry-run` for destructive operations
- Excellent `--help` with examples
- Errors that explain themselves and guide to solutions
- Deterministic, composable, no hidden state

**Non-goals:** Don't wrap jj commands that already work well (`diff`, `log`, `rebase`, `describe`, etc.)

→ [Detailed plan](./plans/cli.md)

## Release & Distribution

**Compiled binaries (v0.1.1+):**
- [x] `bun build --compile` for standalone binaries (darwin-arm64, darwin-x64, linux-arm64, linux-x64)
- [x] Platform-specific npm packages (`kajji-darwin-arm64`, etc.)
- [x] Wrapper package with `optionalDependencies`
- [x] Curl install script
- [x] Published to npm — no Bun required at runtime
- [ ] Homebrew tap

**Version indicator + update notification:**
- [ ] Version indicator in StatusBar (bottom-right, muted, always visible)
- [ ] Update check on startup (GitHub API, once per day, non-blocking)
- [ ] Package manager detection (bun/npm/yarn/pnpm/curl)
- [ ] Toast notification with correct update command
- [ ] State stored in `~/.config/kajji/state.json`

→ [Detailed plan](./plans/release-flows.md)

## Git Remote Operations

- [x] `f` — git fetch (default remote)
- [x] `F` — git fetch all remotes
- [x] `p` — git push change (jj-native, works on any commit)
  - Runs `jj git push --change <selected>` (auto-creates bookmark from change ID)
- [x] `P` — push all tracked bookmarks
- [ ] PR creation after push (`gh pr create` integration)

**jj-native approach:** Change ID is the identity, bookmark is just transport. No naming ceremony — select commit, press `p`, done.

**Note:** jj's push is safe by default (like `git push --force-with-lease`). No force flag needed.

---

## Nice-to-Have

- [ ] Search & filter — `/` to filter log by description/change ID
- [ ] Command mode — `:` to run arbitrary jj commands

---

## Known Issues

### Bugs

- **HIGH:** Divergent change IDs break operations — need to detect and fall back to commit ID
- **HIGH:** Diff doesn't re-render on refresh (manual or auto)
- Help modal has small visual gap between border and outer edge (OpenTUI quirk)
- Search input in help modal doesn't render visually (filtering works though)
- Spaces not rendering in BorderBox corner overlays
- Help modal narrow mode: adjust 3→1 column threshold, make scrollable, fix rendering
- Single-line textarea inputs have slight right margin → [OpenTUI issue draft](./issues/opentui-textarea-width.md)

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

### Horizontal Scrolling & h/l Navigation

- [ ] `h`/`l` or left/right to scroll log sideways (revisions, bookmarks commits, oplog)
- [ ] Fix scrollbox horizontal scroll — currently scrolls only the element under cursor, should scroll entire view
- [ ] Same fix needed for diff panel
- [ ] `h`/`l` or left/right for diff panel horizontal scrolling
- [ ] In file tree: `h`/`l` or left/right to toggle folder collapse/expand
- [ ] Consider: if file selected, right/`l` could focus diff panel — but returning via left/`h` is tricky (only when coming from file tree, not otherwise). Decide when implementing.

### UX Polish

- [ ] Log/bookmark panels slightly wider
- [ ] Selected bookmark should match working copy on load
- [ ] Active bookmark indication when navigating
- [ ] Disable selection highlight in unfocused panels
- [ ] Revisit keybind consistency between revisions and bookmarks panels — e.g., `n` for create bookmark (matches "new"), `d` for rename (matches "describe"). May not be needed once unfocused highlight is disabled.
- [x] All command titles lowercase (e.g., "new" not "New")
- [x] Simplified command titles in context (e.g., "create" not "Create bookmark" in bookmarks context)
- [x] Semantic command grouping in help modal (revisions, files, bookmarks, oplog)

### Technical Debt

- Add unit tests for core operations
- Verify all jj errors shown in command log
- Display more jj output in command log (e.g., "moved bookmark sideways" on push)
- Review dialog API patterns — consider consolidating

---

## Future Ideas

Longer-term possibilities, not actively planned:

- Command mode autocomplete
- Conflict visualization
- Revset filtering
- Interactive rebase UI
- Large repo optimization (10k+ commits)

---

## GitHub PR Stacking

> "Graphite in a TUI" — stacked PRs with jj's clean model, open-source and free.

**Log-centric approach:**
- Multi-select commits in log (contiguous mode) → create stack
- Visual stack editor: rename bookmarks, toggle draft/ready per-PR
- Base PR ready for review, rest draft by default
- Pre-fills existing bookmarks, auto-generates `push-xxx` for others

**Stack viewing:**
- Stacks panel (in bookmarks/refs area) shows all active stacks
- PR status indicators (draft/ready/merged, CI status)
- Drill into stack to see commits and PRs

**Stack reconciliation:**
- On fetch, detect merged PRs
- One-keypress fix: rebase remaining stack, update PR targets
- Handle mid-stack merges (e.g., #2 merged → #3 now targets #1)

**Future: Full PR management:**
- View all PRs (assigned, open, review requested)
- PR descriptions (especially useful for stacks)
- Add comments, approve, request changes, merge

→ [Detailed plan](./plans/github-stacking.md)

---

## Reference

- [archive/lazyjj-plan.md](./archive/lazyjj-plan.md) — Original full specification
- [references/](./references/) — Analysis of jjui, lazyjj, opencode patterns
- [plans/](./plans/) — Detailed feature specs
