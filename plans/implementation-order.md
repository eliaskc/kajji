# Implementation Order - lazierjj

> Getting to a runnable prototype as fast as possible
> 
> **Goal**: See the log, scroll around, view diffs (read-only)

This document outlines the order of implementation to get a working prototype quickly. It does NOT duplicate the full feature specifications in `lazyjj-plan.md` - refer there for detailed behavior, keybindings, and design decisions.

---

## Phase 1: Hello World TUI ✅
**Target: < 1 hour | Validates toolchain**

### 1.1 Project Scaffolding
- [x] Initialize with `bun create tui --template solid` OR manual setup
- [x] Create `package.json` with dependencies
- [x] Create `tsconfig.json` with `jsxImportSource: "@opentui/solid"`
- [x] Create `bunfig.toml` with `preload = ["@opentui/solid/preload"]`
- [x] Create `biome.json` for linting

### 1.2 Minimal Entry Point
- [x] `src/index.tsx` - renders root App component
- [x] Verify `bun run src/index.tsx` shows something on screen
- [x] Add `q` keybinding to quit

### 1.3 Scripts
- [x] `package.json` scripts: `dev`, `check`, `lint`, `lint:fix`, `test`

**Milestone**: ✅ Can run `bun dev`, see text, press `q` to quit.

---

## Phase 2: Commander Foundation ✅
**Target: 1-2 hours | jj CLI abstraction**

### 2.1 Executor
- [x] `src/commander/executor.ts` - wrapper to run jj commands via `Bun.spawn`
- [x] Handle: stdout, stderr, exit code
- [x] `execute()` and `executeWithColor()` functions

### 2.2 Types
- [x] `src/commander/types.ts` - define `Commit` interface

### 2.3 Log Parser (Prefix Injection)
- [x] `src/commander/log.ts` - implements jjui-style prefix injection
- [x] Template injects `__LJ__` markers before `builtin_log_compact`
- [x] Parser extracts metadata, groups lines by commit
- [x] Working copy detected from `@` in graph gutter (like jjui)

### 2.4 Unit Tests
- [x] `tests/unit/commander/log.test.ts` - 6 tests passing

**Milestone**: ✅ Can parse jj log output into structured data.

**Learnings**:
- `self.working_copies()` doesn't work as expected in jj templates - detect from graph gutter instead
- OpenTUI cannot render ANSI escape codes - use `--color never` for now

---

## Phase 3: Log Panel MVP ✅
**Target: 1-2 hours | First real UI**

### 3.1 Basic App Structure
- [x] `src/App.tsx` - root component with keyboard handling
- [x] Uses `useKeyboard()` from @opentui/solid

### 3.2 State Management
- [x] `src/context/sync.tsx` - SolidJS context with signals
  - `commits: Commit[]` signal
  - `selectedIndex: number` signal  
  - `loadLog()`, `selectNext()`, `selectPrev()`, `selectFirst()`, `selectLast()`

### 3.3 Log Panel Component
- [x] `src/components/panels/LogPanel.tsx`
- [x] Shows commit lines with blue background on selected
- [x] Currently shows first line per commit (multi-line deferred)

### 3.4 Navigation
- [x] `j` / `k` / `down` / `up` to move selection
- [x] `g` / `G` for top/bottom
- [x] `q` to quit

**Milestone**: ✅ See real jj log, navigate with j/k, quit with q.

**Learnings**:
- OpenTUI `<text>` doesn't have backgroundColor - wrap in `<box>`
- ANSI codes from jj not rendered by OpenTUI - switched to `--color never`
- Multi-line commits cause selection highlight issues - showing single line for now

---

## Phase 4: Two-Panel Layout + Diff 🚧 IN PROGRESS
**Target: 2-3 hours | Core UX**

### 4.1 Layout Component
- [ ] `src/components/Layout.tsx` - flexbox two-column layout
- [ ] Left: Log panel (~35% width)
- [ ] Right: Main area (~65% width)
- [ ] Use hardcoded ratio for now

### 4.2 Diff Commander
- [ ] `src/commander/diff.ts` - runs `jj diff -r <change_id>`
- [ ] Returns raw string (--color never since OpenTUI can't render ANSI)

### 4.3 Main Area Component  
- [ ] `src/components/panels/MainArea.tsx`
- [ ] Scrollable box showing diff output
- [ ] Plain text for now (colors deferred)

### 4.4 Selection → Diff Wiring
- [ ] When selected commit changes, fetch and display its diff
- [ ] Show loading state while fetching

### 4.5 Focus Management
- [ ] `Tab` to switch focus between Log and MainArea
- [ ] Visual indicator of which panel is focused (border color?)
- [ ] `j/k` scrolls focused panel

**Milestone**: Two panels, select commit on left → see diff on right.

---

## Phase 5: Status Bar + Polish
**Target: 1 hour | Usability**

### 5.1 Status Bar
- [ ] `src/components/StatusBar.tsx` - bottom row
- [ ] Shows context-sensitive keybinding hints
- [ ] Different hints based on focused panel

### 5.2 Additional Navigation
- [ ] `Ctrl+d` / `Ctrl+u` for page down/up in MainArea
- [ ] Scroll position indicator (optional)

### 5.3 Error Handling
- [ ] Show error if not in jj repo
- [ ] Show error if jj command fails

**Milestone**: Polished read-only experience.

---

## Post-Prototype: Next Steps

After Phase 5, you'll have a usable read-only viewer. The next priorities would be:

1. **Actions** (new, edit, describe, squash, abandon)
2. **Bookmarks Panel** 
3. **Modals** (describe, confirm, error)
4. **Command Mode** (`:`)
5. **Config Loading** (from jjconfig.toml)

These are covered in detail in `lazyjj-plan.md`.

---

## File Creation Order

For reference, here's roughly the order files get created:

```
Phase 1:
  package.json, tsconfig.json, bunfig.toml, biome.json
  src/index.tsx

Phase 2:
  src/commander/executor.ts
  src/commander/types.ts
  src/commander/log.ts
  tests/unit/commander/log.test.ts

Phase 3:
  src/App.tsx
  src/context/sync.tsx
  src/components/panels/LogPanel.tsx

Phase 4:
  src/components/Layout.tsx
  src/commander/diff.ts
  src/components/panels/MainArea.tsx

Phase 5:
  src/components/StatusBar.tsx
```

---

## Commands Reference

```bash
# Development
bun dev              # Run the TUI
bun check            # Type check
bun lint             # Lint check
bun lint:fix         # Auto-fix lint issues
bun test             # Run tests

# Manual testing
bun run src/index.tsx
```

---

## Open Questions / Decisions Deferred

1. **ANSI rendering**: ❌ OpenTUI does NOT render ANSI - using `--color never` for now
2. **Diff toggle (`v`)**: Defer until basic diff works
3. **Mouse support**: Defer to post-prototype
4. **Refresh (`R`)**: Add in Phase 5 or defer
5. **Graph characters**: Not rendered yet - jjui does this by parsing gutter separately
6. **Multi-line commits**: Deferred - showing single line per commit for now

