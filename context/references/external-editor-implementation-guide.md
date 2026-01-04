# External Editor Implementation Guide for Kajji

**Based on**: Lazygit's proven patterns  
**Target**: OpenTUI/Solid.js TUI application  
**Language**: TypeScript/Bun

---

## Quick Reference: The Pattern

```typescript
// 1. Suspend TUI
await suspendTUI()

// 2. Run external command with inherited I/O
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

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Action                              │
│              (e.g., "Edit commit message")                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         Controller Handler (e.g., EditCommitHandler)        │
│                                                             │
│  - Determine editor from config                            │
│  - Get editor command template                             │
│  - Determine if suspension needed                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         RunSubprocessAndRefresh(cmdObj)                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Acquire SubprocessMutex (prevent concurrent)     │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 2. Suspend TUI                                      │   │
│  │    - Call gui.g.Suspend()                           │   │
│  │    - Pause background refresh routines              │   │
│  │    - Terminal: disengage() → restore normal mode    │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3. Run Subprocess                                   │   │
│  │    - Inherit stdin/stdout/stderr                    │   │
│  │    - Print command being executed                   │   │
│  │    - Wait for completion                            │   │
│  │    - Optionally wait for user to press Enter        │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 4. Resume TUI                                       │   │
│  │    - Call gui.g.Resume()                            │   │
│  │    - Resume background refresh routines             │   │
│  │    - Terminal: engage() → raw mode                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 5. Release SubprocessMutex                          │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Refresh UI (ASYNC)                             │
│                                                             │
│  - Fetch new state from jj                                 │
│  - Update UI components                                    │
│  - Re-render TUI                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Functions to Implement

### 1. Suspend/Resume Terminal

```typescript
// src/utils/terminal.ts

import { execSync } from 'child_process'

export async function suspendTUI(): Promise<void> {
  // Restore terminal to normal mode
  // This is what tcell's disengage() does:
  // - Disable raw mode
  // - Show cursor
  // - Restore terminal state
  
  // Using termios (Unix):
  try {
    execSync('stty sane', { stdio: 'inherit' })
  } catch (e) {
    // Fallback: use ANSI escape codes
    process.stdout.write('\x1b[?1049l') // Disable alternate screen
    process.stdout.write('\x1b[?25h')   // Show cursor
  }
}

export async function resumeTUI(): Promise<void> {
  // Put terminal back into raw mode for TUI rendering
  // This is what tcell's engage() does:
  // - Enable raw mode
  // - Hide cursor
  // - Set up terminal for TUI
  
  // Using termios (Unix):
  try {
    execSync('stty raw -echo', { stdio: 'inherit' })
  } catch (e) {
    // Fallback: use ANSI escape codes
    process.stdout.write('\x1b[?1049h') // Enable alternate screen
    process.stdout.write('\x1b[?25l')   // Hide cursor
  }
}
```

### 2. Subprocess Execution with I/O Inheritance

```typescript
// src/utils/subprocess.ts

import { spawn } from 'child_process'

export interface SubprocessOptions {
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
  shell?: string
  cwd?: string
}

export async function runSubprocess(
  command: string,
  options: SubprocessOptions = {}
): Promise<{ success: boolean; error?: Error }> {
  return new Promise((resolve) => {
    const {
      stdin = process.stdin,
      stdout = process.stdout,
      stderr = process.stderr,
      shell = process.env.SHELL || '/bin/bash',
      cwd = process.cwd(),
    } = options

    // Print the command being executed
    console.log(`\n\x1b[34m+ ${command}\x1b[0m\n`)

    const subprocess = spawn(shell, ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    })

    // Inherit I/O streams
    stdin.pipe(subprocess.stdin!)
    subprocess.stdout!.pipe(stdout)
    subprocess.stderr!.pipe(stderr)

    subprocess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({
          success: false,
          error: new Error(`Command exited with code ${code}`),
        })
      }
    })

    subprocess.on('error', (error) => {
      resolve({ success: false, error })
    })
  })
}
```

### 3. Mutex-Protected Subprocess Runner

```typescript
// src/utils/subprocess-manager.ts

import { Mutex } from 'async-lock'
import { runSubprocess, SubprocessOptions } from './subprocess'
import { suspendTUI, resumeTUI } from './terminal'

export class SubprocessManager {
  private mutex = new Mutex()
  private backgroundRefreshPaused = false

  async runWithSuspense(
    command: string,
    options: SubprocessOptions = {}
  ): Promise<{ success: boolean; error?: Error }> {
    return this.mutex.acquire('subprocess', async () => {
      try {
        // Suspend TUI
        await suspendTUI()
        this.pauseBackgroundRefreshes(true)

        // Run subprocess
        const result = await runSubprocess(command, options)

        // Resume TUI
        await resumeTUI()
        this.pauseBackgroundRefreshes(false)

        return result
      } catch (error) {
        // Ensure we resume even on error
        await resumeTUI()
        this.pauseBackgroundRefreshes(false)
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }
      }
    })
  }

  private pauseBackgroundRefreshes(paused: boolean): void {
    this.backgroundRefreshPaused = paused
    // Emit event or call callback to pause/resume background tasks
    // This prevents state updates while TUI is suspended
  }

  isBackgroundRefreshPaused(): boolean {
    return this.backgroundRefreshPaused
  }
}
```

### 4. Editor Preset System

```typescript
// src/config/editor-presets.ts

export interface EditorPreset {
  editTemplate: string
  editAtLineTemplate: string
  editAtLineAndWaitTemplate: string
  openDirInEditorTemplate: string
  shouldSuspend: boolean
}

export const EDITOR_PRESETS: Record<string, EditorPreset> = {
  vim: {
    editTemplate: 'vim -- {{filename}}',
    editAtLineTemplate: 'vim +{{line}} -- {{filename}}',
    editAtLineAndWaitTemplate: 'vim +{{line}} -- {{filename}}',
    openDirInEditorTemplate: 'vim -- {{dir}}',
    shouldSuspend: true,
  },
  nvim: {
    editTemplate: 'nvim -- {{filename}}',
    editAtLineTemplate: 'nvim +{{line}} -- {{filename}}',
    editAtLineAndWaitTemplate: 'nvim +{{line}} -- {{filename}}',
    openDirInEditorTemplate: 'nvim -- {{dir}}',
    shouldSuspend: true,
  },
  nano: {
    editTemplate: 'nano -- {{filename}}',
    editAtLineTemplate: 'nano +{{line}} -- {{filename}}',
    editAtLineAndWaitTemplate: 'nano +{{line}} -- {{filename}}',
    openDirInEditorTemplate: 'nano -- {{dir}}',
    shouldSuspend: true,
  },
  helix: {
    editTemplate: 'helix -- {{filename}}',
    editAtLineTemplate: 'helix -- {{filename}}:{{line}}',
    editAtLineAndWaitTemplate: 'helix -- {{filename}}:{{line}}',
    openDirInEditorTemplate: 'helix -- {{dir}}',
    shouldSuspend: true,
  },
  vscode: {
    editTemplate: 'code --reuse-window -- {{filename}}',
    editAtLineTemplate: 'code --reuse-window --goto -- {{filename}}:{{line}}',
    editAtLineAndWaitTemplate: 'code --reuse-window --goto --wait -- {{filename}}:{{line}}',
    openDirInEditorTemplate: 'code -- {{dir}}',
    shouldSuspend: false, // GUI editor, no suspension needed
  },
  sublime: {
    editTemplate: 'subl -- {{filename}}',
    editAtLineTemplate: 'subl -- {{filename}}:{{line}}',
    editAtLineAndWaitTemplate: 'subl --wait -- {{filename}}:{{line}}',
    openDirInEditorTemplate: 'subl -- {{dir}}',
    shouldSuspend: false,
  },
}

export function getEditorPreset(editorName: string): EditorPreset {
  return EDITOR_PRESETS[editorName] || EDITOR_PRESETS.vim
}

export function guessDefaultEditor(): string {
  return (
    process.env.GIT_EDITOR ||
    process.env.VISUAL ||
    process.env.EDITOR ||
    'vim'
  )
}

export function resolveEditorTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(`{{${key}}}`, value)
  }
  return result
}
```

### 5. Editor Helper

```typescript
// src/utils/editor-helper.ts

import path from 'path'
import { SubprocessManager } from './subprocess-manager'
import {
  getEditorPreset,
  guessDefaultEditor,
  resolveEditorTemplate,
} from '../config/editor-presets'

export class EditorHelper {
  constructor(private subprocessManager: SubprocessManager) {}

  async editFiles(filenames: string[]): Promise<void> {
    const absPaths = filenames.map((f) => path.resolve(f))
    const editor = guessDefaultEditor()
    const preset = getEditorPreset(editor)

    const command = resolveEditorTemplate(preset.editTemplate, {
      filename: absPaths.join(' '),
    })

    const result = await this.subprocessManager.runWithSuspense(command)
    if (!result.success) {
      throw result.error
    }
  }

  async editFileAtLine(filename: string, lineNumber: number): Promise<void> {
    const absPath = path.resolve(filename)
    const editor = guessDefaultEditor()
    const preset = getEditorPreset(editor)

    const command = resolveEditorTemplate(preset.editAtLineTemplate, {
      filename: absPath,
      line: String(lineNumber),
    })

    const result = await this.subprocessManager.runWithSuspense(command)
    if (!result.success) {
      throw result.error
    }
  }

  async editFileAtLineAndWait(
    filename: string,
    lineNumber: number
  ): Promise<void> {
    const absPath = path.resolve(filename)
    const editor = guessDefaultEditor()
    const preset = getEditorPreset(editor)

    // Always suspend for this operation, regardless of editor type
    const command = resolveEditorTemplate(
      preset.editAtLineAndWaitTemplate,
      {
        filename: absPath,
        line: String(lineNumber),
      }
    )

    const result = await this.subprocessManager.runWithSuspense(command)
    if (!result.success) {
      throw result.error
    }
  }
}
```

### 6. Signal Handling (Unix)

```typescript
// src/utils/signal-handler.ts

import { execSync } from 'child_process'

export function installResumeSignalHandler(
  onResume: () => Promise<void>
): void {
  process.on('SIGCONT', async () => {
    try {
      // Set foreground process group
      // This allows the terminal to send input to our process
      try {
        execSync('stty sane', { stdio: 'inherit' })
      } catch (e) {
        // Fallback
      }

      // Call the resume handler
      await onResume()
    } catch (error) {
      console.error('Error handling SIGCONT:', error)
    }
  })
}

export function canSuspendApp(): boolean {
  // Only Unix-like systems support SIGSTOP/SIGCONT
  return process.platform !== 'win32'
}
```

---

## Integration with Kajji

### 1. Add to App Context

```typescript
// src/context/subprocess.tsx

import { createContext, useContext } from 'solid-js'
import { SubprocessManager } from '../utils/subprocess-manager'
import { EditorHelper } from '../utils/editor-helper'

interface SubprocessContextType {
  subprocessManager: SubprocessManager
  editorHelper: EditorHelper
}

const SubprocessContext = createContext<SubprocessContextType>()

export function SubprocessProvider(props: { children: any }) {
  const subprocessManager = new SubprocessManager()
  const editorHelper = new EditorHelper(subprocessManager)

  return (
    <SubprocessContext.Provider value={{ subprocessManager, editorHelper }}>
      {props.children}
    </SubprocessContext.Provider>
  )
}

export function useSubprocess() {
  const context = useContext(SubprocessContext)
  if (!context) {
    throw new Error('useSubprocess must be used within SubprocessProvider')
  }
  return context
}
```

### 2. Use in Controllers

```typescript
// src/commands/edit-commit-message.ts

import { useSubprocess } from '../context/subprocess'

export function createEditCommitMessageCommand() {
  return {
    id: 'edit-commit-message',
    context: 'log.revisions',
    keybind: 'e',
    handler: async (commit: Commit) => {
      const { editorHelper } = useSubprocess()

      // Create temporary file with commit message
      const tempFile = await createTempFile(commit.message)

      try {
        // Edit the file
        await editorHelper.editFileAtLine(tempFile, 1)

        // Read the edited content
        const newMessage = await readFile(tempFile)

        // Update the commit
        await updateCommitMessage(commit.hash, newMessage)
      } finally {
        // Clean up
        await deleteFile(tempFile)
      }
    },
  }
}
```

---

## Testing Checklist

- [ ] Suspend/resume terminal state correctly
- [ ] Subprocess inherits stdin/stdout/stderr
- [ ] Multiple subprocess calls don't run concurrently
- [ ] Background refresh pauses during subprocess
- [ ] Background refresh resumes after subprocess
- [ ] Editor detection works for common editors
- [ ] Custom editor templates work
- [ ] GUI editors don't suspend TUI
- [ ] Terminal editors suspend TUI
- [ ] Ctrl+Z suspension handled gracefully (Unix)
- [ ] Error handling doesn't leave TUI in bad state
- [ ] "Press enter to continue" prompt works

---

## Potential Issues & Solutions

### Issue 1: Terminal Left in Raw Mode After Crash
**Solution**: Use try/finally to ensure resumeTUI() is always called

### Issue 2: Subprocess Output Interferes with TUI
**Solution**: Discard subprocess streams after completion, don't pipe to TUI

### Issue 3: Background Tasks Update State While Suspended
**Solution**: Pause background refresh routines before suspend, resume after

### Issue 4: Multiple Subprocesses Run Concurrently
**Solution**: Use mutex to serialize subprocess execution

### Issue 5: Editor Not Found
**Solution**: Fall back to default editor (vim), show warning to user

### Issue 6: Windows Doesn't Support SIGSTOP/SIGCONT
**Solution**: Disable suspension on Windows, run subprocess directly

---

## Performance Considerations

1. **Mutex Overhead**: Minimal - only one subprocess at a time anyway
2. **Terminal Control**: Fast - just a few ANSI codes or stty calls
3. **Background Refresh**: Pausing prevents unnecessary work
4. **I/O Inheritance**: Efficient - direct stream piping

---

## References

- Lazygit Implementation: https://github.com/jesseduffield/lazygit/blob/main/pkg/gui/gui.go
- Tcell Terminal Control: https://github.com/gdamore/tcell
- Node.js Child Process: https://nodejs.org/api/child_process.html
- Unix Signals: https://man7.org/linux/man-pages/man7/signal.7.html
- ANSI Escape Codes: https://en.wikipedia.org/wiki/ANSI_escape_code
