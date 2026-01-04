# External Editor Integration Research

**Research Date**: January 4, 2026  
**Status**: Complete  
**Documents**: 3 comprehensive guides (1,433 lines)

---

## Overview

This directory contains comprehensive research on how **lazygit** handles external editor integration and TUI suspension. The research includes:

1. **Deep technical analysis** of the lazygit codebase
2. **TypeScript/Bun implementation examples** ready for Kajji
3. **Quick reference guides** for common patterns

---

## Documents

### 1. 📚 `lazygit-external-editor-research.md` (545 lines)

**Purpose**: Understand how lazygit implements external editor integration

**Contents**:
- Architecture overview with diagrams
- Core components (suspend/resume, subprocess execution, editor integration)
- Gocui and tcell library integration
- Signal handling for Unix systems
- Usage patterns and design decisions
- Implementation checklist
- Code locations with GitHub permalinks

**Read this first** to understand the pattern.

---

### 2. 💻 `external-editor-implementation-guide.md` (578 lines)

**Purpose**: Implement external editor support in Kajji

**Contents**:
- Architecture diagram
- Complete TypeScript implementations:
  - `suspendTUI()` and `resumeTUI()`
  - `runSubprocess()` with I/O inheritance
  - `SubprocessManager` with mutex protection
  - Editor preset system
  - `EditorHelper` class
  - Signal handling
- Integration with Kajji context
- Testing checklist
- Potential issues and solutions
- Performance considerations

**Read this second** to see working code examples.

---

### 3. ⚡ `external-editor-quick-reference.md` (310 lines)

**Purpose**: Quick lookup during implementation

**Contents**:
- Core pattern (copy-paste ready)
- Key functions table
- Editor presets (terminal vs GUI)
- Template variables
- Critical implementation details
- Terminal control methods
- Common patterns
- Debugging checklist
- Common mistakes to avoid
- Implementation order

**Use this** as a reference while coding.

---

## Quick Start

### For Understanding the Pattern
```
1. Read: lazygit-external-editor-research.md
2. Focus on: "Core Components" section
3. Key insight: Suspend → Run → Resume → Refresh
```

### For Implementation
```
1. Read: external-editor-implementation-guide.md
2. Start with: "Core Functions to Implement" section
3. Copy: Code examples into your project
4. Test: Each phase before moving to next
```

### For Quick Lookup
```
1. Use: external-editor-quick-reference.md
2. Find: Your specific need in the tables
3. Copy: Code snippet or pattern
4. Adapt: To your use case
```

---

## The Core Pattern

```typescript
// 1. Suspend TUI
await suspendTUI()

// 2. Run command with inherited I/O
const result = await runSubprocess(command, {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
})

// 3. Resume TUI
await resumeTUI()

// 4. Refresh UI
refreshUI()
```

---

## Key Findings

### 1. Suspend/Resume Mechanism
- Lazygit calls `gui.g.Suspend()` which delegates to tcell's `disengage()`
- This restores the terminal to normal mode
- `Resume()` calls tcell's `engage()` to re-enable raw mode

### 2. Subprocess Execution
- Mutex-protected to prevent concurrent execution
- Subprocess inherits stdin/stdout/stderr from parent
- Allows full user interaction with external commands

### 3. Background Task Management
- Background refresh routines are paused during subprocess
- Prevents state updates while TUI is suspended
- Critical for preventing UI corruption

### 4. Editor Integration
- Different editors have different suspend requirements
- Terminal editors (vim, nano) require suspension
- GUI editors (VSCode, Sublime) don't require suspension
- Editor detection via environment variables

### 5. Signal Handling
- Listens for SIGCONT to handle user-initiated suspension (Ctrl+Z)
- Unix-only (Windows doesn't support SIGSTOP/SIGCONT)

---

## Implementation Phases

### Phase 1: Terminal Control
- [ ] Implement `suspendTUI()` - restore normal mode
- [ ] Implement `resumeTUI()` - enable raw mode
- [ ] Test with stty and ANSI escape codes

### Phase 2: Subprocess Execution
- [ ] Implement `runSubprocess()` with I/O inheritance
- [ ] Implement `SubprocessManager` with mutex
- [ ] Add error handling and recovery

### Phase 3: Editor Integration
- [ ] Create editor preset system
- [ ] Implement editor detection
- [ ] Support custom templates

### Phase 4: Background Task Management
- [ ] Pause background refresh during subprocess
- [ ] Resume after subprocess completes
- [ ] Prevent state updates while suspended

### Phase 5: Signal Handling
- [ ] Install SIGCONT handler (Unix)
- [ ] Set foreground process group
- [ ] Disable on Windows

### Phase 6: Integration
- [ ] Add to Kajji context
- [ ] Integrate with jj commands
- [ ] Test with common editors

---

## Critical Implementation Details

### 1. Mutex Protection
Prevents concurrent subprocess execution. Use `async-lock` or similar.

### 2. Background Task Pausing
**MUST** pause before suspend, **MUST** resume after resume.

### 3. I/O Inheritance
```typescript
subprocess.stdin = process.stdin
subprocess.stdout = process.stdout
subprocess.stderr = process.stderr
```

### 4. Error Recovery
Use try/finally to ensure `resumeTUI()` is always called.

### 5. Editor Detection
Check `GIT_EDITOR` → `VISUAL` → `EDITOR` → default to `vim`

---

## Code Locations (Lazygit)

| Component | File | Lines |
|-----------|------|-------|
| Main subprocess flow | `pkg/gui/gui.go` | 914-990 |
| Editor integration | `pkg/gui/controllers/helpers/files_helper.go` | 63-71 |
| Editor presets | `pkg/config/editor_presets.go` | 1-195 |
| Signal handling | `pkg/gui/controllers/helpers/signal_handling.go` | 1-60 |
| Suspend/Resume helper | `pkg/gui/controllers/helpers/suspend_resume_helper.go` | 1-32 |
| Gocui integration | `vendor/github.com/jesseduffield/gocui/gui.go` | Suspend/Resume |
| Tcell integration | `vendor/github.com/gdamore/tcell/v2/tscreen.go` | Suspend/Resume |

---

## Editor Presets

### Terminal Editors (suspend = true)
- vim, nvim, nano, helix, emacs, kakoune, lvim, micro

### GUI Editors (suspend = false)
- vscode, sublime, bbedit, xcode, zed, acme

---

## Common Patterns

### Pattern 1: Edit File
```typescript
const tempFile = '/tmp/edit.txt'
await writeFile(tempFile, content)
await editorHelper.editFileAtLine(tempFile, 1)
const newContent = await readFile(tempFile)
await deleteFile(tempFile)
```

### Pattern 2: Edit with Line Number
```typescript
await editorHelper.editFileAtLine('/path/to/file.ts', 42)
```

### Pattern 3: Wait for Editor
```typescript
// Always suspend, even for GUI editors
await editorHelper.editFileAtLineAndWait(file, line)
```

---

## Debugging Checklist

- [ ] Terminal not restoring after crash?
  → Add try/finally to `resumeTUI()`

- [ ] Subprocess output mixed with TUI?
  → Discard streams after subprocess completes

- [ ] UI updates while editor open?
  → Check `pauseBackgroundRefreshes()` is called

- [ ] Multiple editors running?
  → Verify mutex is working

- [ ] Editor not found?
  → Check EDITOR/VISUAL env vars, fall back to vim

- [ ] Ctrl+Z doesn't work?
  → Only works on Unix, check platform

- [ ] Terminal stuck in raw mode?
  → Run `stty sane` in another terminal

---

## Common Mistakes to Avoid

❌ **Don't**: Forget to resume TUI on error
✅ **Do**: Use try/finally

❌ **Don't**: Run multiple subprocesses concurrently
✅ **Do**: Use mutex to serialize

❌ **Don't**: Update UI while subprocess running
✅ **Do**: Pause background refresh

❌ **Don't**: Pipe subprocess output to TUI
✅ **Do**: Inherit streams directly

❌ **Don't**: Assume all editors suspend
✅ **Do**: Check editor preset

❌ **Don't**: Ignore Windows limitations
✅ **Do**: Disable suspension on Windows

---

## Resources

- **Lazygit Repository**: https://github.com/jesseduffield/lazygit
- **Gocui Library**: https://github.com/jesseduffield/gocui
- **Tcell Library**: https://github.com/gdamore/tcell
- **Node.js Child Process**: https://nodejs.org/api/child_process.html
- **Unix Signals**: https://man7.org/linux/man-pages/man7/signal.7.html
- **ANSI Escape Codes**: https://en.wikipedia.org/wiki/ANSI_escape_code

---

## Next Steps

1. **Understand**: Read `lazygit-external-editor-research.md`
2. **Implement**: Follow `external-editor-implementation-guide.md`
3. **Reference**: Use `external-editor-quick-reference.md` while coding
4. **Test**: Verify each phase works before moving to next
5. **Integrate**: Add to Kajji context and jj commands

---

## Questions?

See the **FAQ** section in `external-editor-quick-reference.md` for common questions.

---

## Document Statistics

| Document | Lines | Size | Focus |
|----------|-------|------|-------|
| lazygit-external-editor-research.md | 545 | 16K | Understanding |
| external-editor-implementation-guide.md | 578 | 19K | Implementation |
| external-editor-quick-reference.md | 310 | 7.2K | Reference |
| **Total** | **1,433** | **42.2K** | **Complete** |

---

**Last Updated**: January 4, 2026  
**Research Status**: Complete  
**Ready for Implementation**: Yes
