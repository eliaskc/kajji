# kajji

> Project tracker — features, plans, and known issues in one place.

---

## Core Viewing

- [x] Log panel — full jj log with ANSI colors, graph symbols, metadata
- [x] Diff viewer — full ANSI color support (difftastic, delta, etc.)
- [x] Two-panel layout — log/bookmarks left, diff/detail right
- [x] Commit header — author, date, timezone, empty status, description
- [x] Rich commit details — full message (subject + body) + file stats
- [ ] Commit header indicators — bookmarks, workspace, git HEAD, remote tracking

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
  - [x] `b` — set bookmark on selected commit (move existing or create new; works in Log and Bookmarks commits view)
  - [x] `m` — move bookmark to different commit (in bookmarks list view)
- [ ] Bookmark operations (Phase 2 — medium effort)
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
- [x] Status bar — context commands (left, truncates on narrow terminals) + global commands (right, fixed)
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

## Next Up

Priority queue after pre-release polish:

1. **Fix HIGH bugs** (see Known Issues below)
   - [x] Divergent change IDs break operations
   - [x] Diff doesn't re-render on refresh
2. [x] **Basic rebase** — `r` to rebase selected commit onto target (revset picker)
3. [x] **Basic split** — `S` to invoke `jj split` on selected commit (opens in `$EDITOR`)
4. **Picker & list improvements**
   - [ ] Bookmark picker: fuzzy search/filtering
   - [ ] Bookmark picker: mouse click to select
   - [ ] Bookmark sorting: by recently changed (not alphabetical) — in picker and bookmarks tab
   - [ ] Bookmark grouping: user-modified first, remote-only second (approximates local/remote in git; assumes tracked bookmarks)
   - [ ] Revset picker: same filtering/mouse support

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
- [x] Split/unified view with width-based default (split if mainAreaWidth >= 90)
- [x] Dynamic line number width — adapts to max line number across all files
- [x] Unified view single-column gutter with colored numbers (deletion=red, addition=green)
- [x] Syntax highlighting via Shiki (`ayu-dark` theme)
- [ ] Synchronized horizontal scroll — both sides of split diff scroll together (like @pierre/diffs)
- [ ] Layout modes — half-width, full-width, unified
- [ ] Auto-switch based on terminal width
- [ ] Manual toggle keybind (`v` or `+`/`-`)
- [ ] Difftastic integration with correct width
- [ ] Diff theming — refactor hardcoded diff colors to `src/theme/` → [plan](./plans/custom-diff-renderer.md#theming)

→ [Detailed plan](./plans/diff-viewing.md)

## Custom Diff Renderer (Future)

> Post-CLI milestone. Configurable — users can opt out and use jj's native diff output.

**Why custom rendering:**
- jj-specific context (revision metadata, parent relationships, "this will squash into X" hints)
- Deep keybind integration (navigate hunks, stage/unstage at hunk level)
- Theme consistency with kajji's lazygit/opencode themes
- Foundation for PR review features (inline comments, approval workflows)

**Features:**
- [ ] Side-by-side diff with aligned old/new panels
- [ ] Hunk navigation with keyboard shortcuts (`[`/`]` or `n`/`N`)
- [ ] Word-level change highlighting
- [ ] Syntax highlighting per filetype
- [ ] Inline action hints (what operations will affect this code)
- [ ] PR review: inline comments (future, when PR management lands)

**Escape hatch (critical):**
- [ ] Config option: `diff.renderer = "native" | "kajji"`
- [ ] Native mode: use `jj diff --color always` output directly
- [ ] Respects user's jj config (difftastic, delta, etc.)

→ [Diff viewing plan](./plans/diff-viewing.md)

Inspiration: [lumen](https://github.com/jnsahaj/lumen) — beautiful CLI diff viewer with side-by-side layout

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
- [ ] **Push behavior in log.revisions:**
  - If revision has bookmark(s): push the bookmark(s)
  - If no bookmark: show modal offering `--change` push (auto-creates `push-<id>` bookmark)
  - Modal shows: "No bookmark on this revision. Push as `push-<changeId>`?" with y/n
- [ ] PR creation after push (`gh pr create` integration)

**jj-native approach:** Change ID is the identity, bookmark is just transport. No naming ceremony — select commit, press `p`, done.

**Note:** jj's push is safe by default (like `git push --force-with-lease`). No force flag needed.

---

## Revset Filtering

Revsets are jj's query language for selecting commits (e.g., `trunk()..@`, `author(me)`, `description(fix)`, `all()`). Users need to filter the log and see further back than jj's default visible set.

- [ ] `/` — open revset input modal in log.revisions and log.oplog
- [ ] Show current revset in panel title when filtered (e.g., `[1]─Log (author(me))`)
- [ ] Clear filter with Escape or empty input
- [ ] Preset shortcuts for common filters (e.g., `a` for all, `m` for mine)

## Nice-to-Have

- [ ] Command mode — `:` to run arbitrary jj commands
- [ ] Smart paste in describe modal — if pasted text contains a newline, put first line in subject and rest in body

## Open in Editor

- [ ] `e` — open selected file in `$EDITOR` (in file tree views)
- [ ] `E` — open all files from selected commit in `$EDITOR`
  - Get file list from commit's diff summary
  - Pass all paths to editor: `$EDITOR file1 file2 file3`
  - Most editors handle multiple files (nvim tabs/splits, VSCode tabs, etc.)
- [ ] Works in: log.files, bookmarks.files
- [ ] Respect `$VISUAL` over `$EDITOR` if set (standard convention)
- [ ] Suspend TUI while editor runs, restore on exit

---

## Search & Filtering

General pattern: list views with many items need filtering/search.

See also: **Picker & list improvements** in Next Up (high priority bookmark/revset picker work).

- [ ] **File tree search** — `/` to filter files by name in file tree views (log.files, bookmarks.files)
  - Fuzzy match on file path
  - Show matching files only (collapse non-matching folders)
  - Clear with Escape or empty input
- [ ] **Revisions by file** — search for commits that touched files matching a pattern
  - Could integrate with revset: `jj log -r 'file("pattern")'`
  - Or custom UI: `/` in log.revisions opens file filter mode
- [ ] **Workspace picker** — filtering when implemented

Part of broader search/filter work (see Revset Filtering above).

---

## Confirmation Flags

jj commands that modify history require confirmation flags. We handle `--ignore-immutable` with a confirmation modal. Other flags to handle:

- [ ] **`--allow-backwards`** — required when moving bookmarks backwards/sideways
  - `jj bookmark set` — when target is ancestor of current position
  - `jj bookmark move` — same case
  - UX: detect when needed, show confirmation modal ("This will move bookmark backwards. Continue?")
- [ ] **`--ignore-immutable`** — already implemented with confirmation modal
- [ ] **`--allow-large-revsets`** — for operations affecting many commits
  - `jj rebase` with broad revsets
  - `jj abandon` with multiple commits
  - UX: show count warning ("This will affect N commits. Continue?")

**Implementation pattern:**
1. Run command without flag
2. Parse error output for specific error codes/messages
3. Show appropriate confirmation modal
4. Re-run with flag if confirmed

---

## Known Issues

### Bugs

- Commit header (subject, body, file stats) doesn't update on auto-refresh — only updates when navigating to a different commit
- Help modal has small visual gap between border and outer edge (OpenTUI quirk)
- Search input in help modal doesn't render visually (filtering works though)
- Spaces not rendering in BorderBox corner overlays
- Help modal narrow mode: scroll-to-selection only works in 1-column mode (multi-column doesn't need it typically)
- Single-line textarea inputs have slight right margin (body textarea doesn't have this issue) → [OpenTUI issue draft](./issues/opentui-textarea-width.md)
- Modals with multiple focusable sections (e.g., SetBookmarkModal, DescribeModal) need mouse click support to switch focus between sections (see also: Picker improvements in Next Up)

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

- [ ] Command execution feedback — make command state and output more visible
  - Show running state prominently for async operations (spinner, status text)
  - Always show raw jj output in command log (not just errors) — e.g., "moved bookmark sideways", what was pushed, rebase results
  - Clear indicator when done + success/failure state
  - Consider: toast, modal, or highlighted command log entry for important results
- [ ] Change edit keybind from `e` to `Space` for revisions (more ergonomic)
- [ ] Status bar truncation indicator — show `...` when context commands are truncated due to narrow terminal
- [ ] List position indicator — show "X of Y" on panel borders for scrollable lists (revisions, files, bookmarks, commits, oplog). Like lazygit. Decide: always show vs. only when overflow.
- [x] Log/bookmark panels slightly wider
- [ ] Selected bookmark should match working copy on load
- [ ] Active bookmark indication when navigating
- [x] Disable selection highlight in unfocused panels
- [ ] Keep file selection highlight visible when diff panel is focused (files remain navigable via mouse even when diff is focused)
- [ ] Revisit keybind consistency between revisions and bookmarks panels — e.g., `n` for create bookmark (matches "new"), `d` for rename (matches "describe"). May not be needed once unfocused highlight is disabled.
- [x] All command titles lowercase (e.g., "new" not "New")
- [x] Simplified command titles in context (e.g., "create" not "Create bookmark" in bookmarks context)
- [x] Semantic command grouping in help modal (revisions, files, bookmarks, oplog)

### Technical Debt

- Add unit tests for core operations
- Verify all jj errors shown in command log
- Review dialog API patterns — consider consolidating
- Decompose sync.tsx into focused contexts → [plan](./plans/sync-decomposition.md)

---

## Future Ideas

Longer-term possibilities, not actively planned:

- Command mode autocomplete
- Conflict visualization
- Revset filtering
- Interactive rebase UI
- Large repo optimization (10k+ commits)

### Exploratory: PR Management

PR management is exploratory — the risk is becoming an "everything TUI" that overlaps too much with existing tools. Build for personal use first, evaluate fit.

**PR Management** → [plan](./plans/pr-management.md)
- View/filter PRs (open, assigned, created by me, review requested)
- PR actions: approve, comment (inline), merge
- GitHub file sync (track viewed files)
- Full review workflow without leaving terminal

**Architectural options** (if this expands):
- Integrated panels within existing TUI
- Separate tab (`[jj] [PR]`)
- Completely separate TUI

### AI/LLM Integration (Mostly Out of Scope)

**Healthy skepticism toward AI features.** Most AI integration requires entirely new UX flows and significantly inflates scope. kajji should stay focused on being an excellent jj TUI, not an AI-powered development assistant. Many dedicated tools already exist (aicommits, gptcommit, lumen, Claude Code, Copilot).

**Maybe in scope:** → [plan](./plans/ai-integration.md)
- Commit message generation from diff (like [lumen](https://github.com/jnsahaj/lumen)) — low-friction, well-defined

**Out of scope:**
- Explain changes (revision → file → hunk) — too much UX investment
- Hunk selection for AI queries — requires custom diff renderer first
- AI-assisted jj actions — external agents (Claude Code, etc.) do this better
- AI-assisted PR review — only reconsider if PR management lands AND there's clear value

**If PR management is implemented:** Comment generation with human review *could* be reconsidered, but maintain skepticism about the UX complexity.

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

**External inspiration:**
- [lumen](https://github.com/jnsahaj/lumen) — Rust CLI: beautiful side-by-side diff viewer, AI commit messages, git workflow tools
