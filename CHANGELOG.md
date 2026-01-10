# Changelog

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
