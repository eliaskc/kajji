# Changelog

## 0.6.1

### fixed
- ux: what's new screen shows with wave background instead of as modal overlay ([`c725500f`](../../commit/c725500f))

## 0.6.0

### new
- line wrapping toggle (`w`) for diff views ([`b3751588`](../../commit/b3751588))
- binary file detection with indicator in file tree, prevents loading binary diffs ([`47e26007`](../../commit/47e26007))
- horizontal mouse scrolling in diff and log panels ([`a49bb5c1`](../../commit/a49bb5c1), [`06a44e53`](../../commit/06a44e53))
- path truncation in diff file headers for long paths ([`143196c3`](../../commit/143196c3))
- "what's new" modal shows changelog after version updates ([`67fc8e05`](../../commit/67fc8e05))
- status bar shows diff view keybinds (`w` wrap, `v` split/unified) ([`ce220d00`](../../commit/ce220d00))

### improved
- ux: squash and rebase modals larger for better visibility ([`7297f643`](../../commit/7297f643))
- perf: streaming log parse for faster initial render ([`65fd58b9`](../../commit/65fd58b9))
- ux: smoother scrolling, reduced loading flicker ([`6e1961ad`](../../commit/6e1961ad))

### fixed
- file tree: single-click selects folder, double-click expands/collapses ([`d6cda93d`](../../commit/d6cda93d))
- diff: file paths with spaces handled correctly ([`db69a08f`](../../commit/db69a08f))
- diff: unchanged line gaps visually distinct from file whitespace ([`6ed6f730`](../../commit/6ed6f730))
- diff: header width clamped, scroll position bounded ([`aeca9bdc`](../../commit/aeca9bdc))
- diff: increased overscan buffer to prevent blank flashes ([`6ff93157`](../../commit/6ff93157))

## 0.5.1

### fixed
- syntax highlighting not working in compiled binaries ([`2763cbd`](../../commit/2763cbd))

## 0.5.0

### new
- squash modal (`s`) with target picker and flag options (`u` use dest msg, `K` keep emptied, `i` interactive) ([`75523fb`](../../commit/75523fb))
- rebase modal (`r`) with flag shortcuts (`s` descendants, `b` branch, `e` skip emptied, `a` after, `B` before) ([`a7bcd0b`](../../commit/a7bcd0b))

### fixed
- ux: page up/down command titles lowercase ([`511fb4d`](../../commit/511fb4d))

## 0.4.2

### new
- tab switching with `h`/`l` and arrow keys in addition to `[`/`]` ([`c7c3ff5`](../../commit/c7c3ff5))

## 0.4.1

### new
- new before command (`N`) to insert revision as parent of selected ([`3cbd0a32`](../../commit/3cbd0a32))

## 0.4.0

### new
- revset filtering in log panel (`/`) with error display and persistent filter ([`2b2ba7c7`](../../commit/2b2ba7c7))
- fuzzy filtering in bookmarks panel and file tree (`/`) ([`40073a9c`](../../commit/40073a9c))
- fuzzy search in set bookmark modal ([`9c9bd18f`](../../commit/9c9bd18f))
- bookmarks sorted by recency (most recently committed first) ([`671596f3`](../../commit/671596f3))
- streaming bookmark list for faster loading in large repos ([`aafdc88b`](../../commit/aafdc88b))

### improved
- perf: paginated log and bookmark loading for large repos ([`15fda895`](../../commit/15fda895))

### fixed
- layout: log panel tabs only highlighted when panel is focused ([`32a24af0`](../../commit/32a24af0))
- layout: focus mode stable in files view ([`e15fd943`](../../commit/e15fd943))

## 0.3.1

### removed
- ANSI passthrough diff mode and `v` keybind — diff view now always uses custom renderer

## 0.3.0

### new
- custom diff rendering with syntax highlighting, word-level diffs, and virtualization ([#3](../../pull/3))
- focus modes: toggle between normal and diff (`ctrl+x`) with narrow log sidebar ([`e63774bc`](../../commit/e63774bc))
- error screen for critical startup errors with auto-fix for stale working copy ([`6cb8596b`](../../commit/6cb8596b))
- startup screen when not in a jj/git repository ([`e438f12a`](../../commit/e438f12a))
- recent repository switcher modal (`ctrl+o`) ([`14ff9bf1`](../../commit/14ff9bf1))
- commit header with jj native refLine (bookmarks, git_head, workspace) ([`615ae8b4`](../../commit/615ae8b4))
- syntax highlighting for 16 additional languages ([`59aa5ad3`](../../commit/59aa5ad3))
- CLI argument to specify directory (`kajji /path/to/repo`) ([`be4582a6`](../../commit/be4582a6))
- animated ocean wave on startup screen ([`de5cebee`](../../commit/de5cebee))
- automatic update checker with toast notifications

### improved
- perf: faster startup by disabling Shiki syntax warmup ([`196a840b`](../../commit/196a840b))

### fixed
- diff view contents now update on refresh ([`1634edf1`](../../commit/1634edf1))
- perf: reduced flicker at diff top/bottom on scroll ([`98b6dc13`](../../commit/98b6dc13))
- layout: blank spacer removed from top of diff when scrolling ([`53705b93`](../../commit/53705b93))
- ux: commit header only shows in file tree view, not diff mode ([`7d9a9143`](../../commit/7d9a9143))

## 0.2.0

### new
- rebase command (`r`) with revision picker
- split command (`S`) with TUI suspend/resume
- move bookmark here command for revisions in log and refs
- undo/redo as global commands with help-only visibility
- confirmation modal for edit or abandon on immutable commits
- command log panel focusable (`4`) with keyboard scroll
- search in help modal only shows matching results
- set bookmark modal: combined flow for moving existing or creating new bookmark on selected commit

### improved
- ux: status bar truncates gracefully, commands grouped by context (left truncates, right fixed)
- ux: help modal scrolls with visible scrollbar, responsive column layout
- ux: replace input with textarea for paste and word navigation support
- ux: selection highlight only shown in focused panels
- layout: panel ratios now based on mode (files vs revisions), not focus state
- layout: command log expands to 15 lines when focused
- theming: modal title colors match border (focused and unfocused)
- theming: slight gray instead of white for borders and text, more consistent token usage

### fixed
- divergent commits now handled correctly (uses commit ID instead of change ID)
- perf: undo/redo modal loads data before display (no flash)
- scroll effect infinite loop prevented by using explicit deps
- inner box in BorderBox now fills parent for expected sizing
- commit body parsed from full description instead of removed API
- proper OpenTUI API for scrollbox viewport height

## 0.1.0

initial release
