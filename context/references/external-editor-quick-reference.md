# External Editor Integration - Quick Reference

## The Core Pattern (Copy-Paste Ready)

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

## Key Functions

| Function | Purpose | Returns |
|----------|---------|---------|
| `suspendTUI()` | Restore terminal to normal mode | `Promise<void>` |
| `resumeTUI()` | Put terminal back in raw mode | `Promise<void>` |
| `runSubprocess(cmd, opts)` | Execute command with I/O inheritance | `Promise<{success, error}>` |
| `runWithSuspense(cmd, opts)` | Run subprocess with suspend/resume | `Promise<{success, error}>` |
| `editFiles(filenames)` | Open files in editor | `Promise<void>` |
| `editFileAtLine(file, line)` | Open file at specific line | `Promise<void>` |

---

## Editor Presets

### Terminal Editors (suspend = true)
- vim, nvim, nano, helix, emacs, kakoune, lvim, micro

### GUI Editors (suspend = false)
- vscode, sublime, bbedit, xcode, zed, acme

### Detection
```typescript
const editor = process.env.GIT_EDITOR || 
               process.env.VISUAL || 
               process.env.EDITOR || 
               'vim'
```

---

## Template Variables

```
{{filename}}  - File path(s)
{{line}}      - Line number
{{dir}}       - Directory path
```

Example:
```typescript
'vim +{{line}} -- {{filename}}'
// becomes: 'vim +42 -- /path/to/file.txt'
```

---

## Critical Implementation Details

### 1. Mutex Protection
```typescript
private mutex = new Mutex()

async runWithSuspense(command) {
  return this.mutex.acquire('subprocess', async () => {
    // Only one subprocess at a time
  })
}
```

### 2. Background Task Pausing
```typescript
await suspendTUI()
pauseBackgroundRefreshes(true)  // ← CRITICAL
// ... run subprocess ...
pauseBackgroundRefreshes(false)
await resumeTUI()
```

### 3. I/O Inheritance
```typescript
subprocess.stdin = process.stdin    // User can type
subprocess.stdout = process.stdout  // User sees output
subprocess.stderr = process.stderr  // User sees errors
```

### 4. Error Recovery
```typescript
try {
  await suspendTUI()
  // ... run subprocess ...
} finally {
  await resumeTUI()  // Always restore, even on error
}
```

---

## Terminal Control Methods

### Method 1: stty (Recommended)
```bash
stty sane          # Restore normal mode
stty raw -echo     # Enable raw mode
```

### Method 2: ANSI Escape Codes (Fallback)
```
\x1b[?1049l  # Disable alternate screen
\x1b[?25h    # Show cursor
\x1b[?1049h  # Enable alternate screen
\x1b[?25l    # Hide cursor
```

### Method 3: termios (Low-level)
```c
tcgetattr(fd, &term)
cfmakeraw(&term)
tcsetattr(fd, TCSAFLUSH, &term)
```

---

## Signal Handling (Unix Only)

```typescript
process.on('SIGCONT', async () => {
  // User pressed Ctrl+Z and then fg
  await resumeTUI()
})

// Windows: Not supported, skip
if (process.platform !== 'win32') {
  installResumeSignalHandler()
}
```

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

### Pattern 4: Custom Editor
```typescript
const preset = getEditorPreset('nvim')
const cmd = resolveEditorTemplate(preset.editTemplate, {
  filename: '/path/to/file.ts'
})
await subprocessManager.runWithSuspense(cmd)
```

---

## Debugging Checklist

- [ ] Terminal not restoring after crash?
  → Add try/finally to resumeTUI()

- [ ] Subprocess output mixed with TUI?
  → Discard streams after subprocess completes

- [ ] UI updates while editor open?
  → Check pauseBackgroundRefreshes() is called

- [ ] Multiple editors running?
  → Verify mutex is working

- [ ] Editor not found?
  → Check EDITOR/VISUAL env vars, fall back to vim

- [ ] Ctrl+Z doesn't work?
  → Only works on Unix, check platform

- [ ] Terminal stuck in raw mode?
  → Run `stty sane` in another terminal

---

## Performance Tips

1. **Lazy Load Editors**: Don't detect editor until needed
2. **Cache Presets**: Store editor preset in memory
3. **Async Operations**: Don't block UI during subprocess
4. **Stream Piping**: Use direct pipe, not buffering
5. **Minimal Terminal Control**: Use stty, not ANSI codes if possible

---

## Lazygit Code References

| Component | File | Key Function |
|-----------|------|--------------|
| Main flow | `pkg/gui/gui.go` | `runSubprocessWithSuspense()` |
| Editor integration | `pkg/gui/controllers/helpers/files_helper.go` | `callEditor()` |
| Editor presets | `pkg/config/editor_presets.go` | `GetEditTemplate()` |
| Signal handling | `pkg/gui/controllers/helpers/signal_handling.go` | `installResumeSignalHandler()` |
| Suspend/Resume | `vendor/github.com/jesseduffield/gocui/gui.go` | `Suspend()`, `Resume()` |
| Terminal control | `vendor/github.com/gdamore/tcell/v2/tscreen.go` | `disengage()`, `engage()` |

---

## Implementation Order

1. ✅ Understand the pattern (you are here)
2. Implement `suspendTUI()` and `resumeTUI()`
3. Implement `runSubprocess()` with I/O inheritance
4. Implement `SubprocessManager` with mutex
5. Implement editor preset system
6. Implement `EditorHelper` class
7. Add signal handling for Ctrl+Z
8. Integrate with Kajji context
9. Test with common editors
10. Add to command handlers

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

## Next Steps

1. Read `lazygit-external-editor-research.md` for deep dive
2. Read `external-editor-implementation-guide.md` for code examples
3. Start with `suspendTUI()` and `resumeTUI()`
4. Test with `vim` first (most common)
5. Add other editors incrementally
6. Integrate with jj commands (edit commit, rebase, etc.)

---

## Questions?

- **How do I detect the user's editor?**
  → Check `GIT_EDITOR`, `VISUAL`, `EDITOR` env vars

- **What if the editor isn't in the presets?**
  → Fall back to vim, or ask user to configure

- **Can I use GUI editors?**
  → Yes, but set `suspend: false` in preset

- **What about Windows?**
  → Disable suspension, run subprocess directly

- **How do I handle editor errors?**
  → Check return code, show error to user

- **Can I customize editor commands?**
  → Yes, allow users to override templates in config

---

## Resources

- Lazygit: https://github.com/jesseduffield/lazygit
- Tcell: https://github.com/gdamore/tcell
- Node.js Child Process: https://nodejs.org/api/child_process.html
- Unix Signals: https://man7.org/linux/man-pages/man7/signal.7.html
