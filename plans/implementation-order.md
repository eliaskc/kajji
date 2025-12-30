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

## Phase 4: Two-Panel Layout + Diff ✅
**Target: 2-3 hours | Core UX**

### 4.1 Layout Component
- [x] `src/components/Layout.tsx` - flexbox two-column layout
- [x] Left: Log panel (flexGrow=1)
- [x] Right: Main area (flexGrow=2)
- [x] Explicit `height="100%"` on all containers to fill terminal

### 4.2 Diff Commander
- [x] `src/commander/diff.ts` - runs `jj diff -r <change_id> --color never`
- [x] Returns raw string

### 4.3 Main Area Component  
- [x] `src/components/panels/MainArea.tsx`
- [x] Shows diff output line by line
- [x] Loading/error states

### 4.4 Selection → Diff Wiring
- [x] `createEffect` in sync.tsx triggers loadDiff on selection change
- [x] diff/diffLoading/diffError signals in context

### 4.5 Focus Management
- [x] `Tab` to switch focus between Log and MainArea
- [x] Visual indicator of which panel is focused (border color: cyan=#4ECDC4 when focused, gray=#444444 when not)
- [x] `j/k` scrolls focused panel (log selection when log focused, scrollbox handles diff when diff focused)
- [x] Use `<scrollbox>` for MainArea diff content (proper scrolling)

**Milestone**: Two panels, select commit on left → see diff on right.

**Notes**:
- Using flex ratios (1:2) for panel widths
- Must set explicit `height="100%"` on all flex containers to fill terminal viewport
- ANSI rendering solved with `ghostty-opentui` - parses ANSI to styled spans
- Focus indicated by border color (cyan when focused, gray when not)
- `focusedPanel` signal in sync context tracks which panel has focus

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

1. **ANSI rendering**: ❌ OpenTUI does NOT render ANSI - using `--color never` for now (see Future Enhancement below)
2. **Diff toggle (`v`)**: Defer until basic diff works
3. **Mouse support**: Defer to post-prototype
4. **Refresh (`R`)**: Add in Phase 5 or defer
5. **Graph characters**: Not rendered yet - jjui does this by parsing gutter separately
6. **Multi-line commits**: Deferred - showing single line per commit for now

---

## Future Enhancement: ANSI → OpenTUI Styled Rendering

**Problem**: We want to honor the user's configured diff tool output (difftastic, delta, etc.) which outputs ANSI-colored text. OpenTUI cannot render raw ANSI escape codes.

**Solution**: Use `ghostty-opentui` package - Ghostty's Zig-based terminal emulator for robust ANSI parsing.

**Why ghostty-opentui over manual regex parsing?**
- Full VT terminal emulation (handles complex escape sequences)
- 16/256/RGB colors, bold, italic, underline, strikethrough, faint
- Performance: Parsing at Zig level, not JS
- Battle-tested in production (used by critique)

**Why not use OpenTUI's `<diff>` component?**: It bypasses the user's diff tool choice. We want `jj diff` to use whatever the user has configured.

**Implementation plan**:
1. `bun add ghostty-opentui`
2. Change diff commander to use `--color always`
3. Create `src/components/AnsiText.tsx` using `ptyToJson()`
4. Use in MainArea with `<scrollbox>`

**Effort**: ~1-2 hours (simpler than manual parsing!)

**Priority**: Post-MVP enhancement (Phase 6+). Plain text diff is acceptable for prototype.

**Detailed research**: See `plans/opentui-research.md`

**References**:
- ghostty-opentui: https://github.com/remorses/ghostty-opentui
- critique (production example): https://github.com/remorses/critique
- OpenTUI examples: https://github.com/sst/opentui/tree/main/packages/solid/examples

