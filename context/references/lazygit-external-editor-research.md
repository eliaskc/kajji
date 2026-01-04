# Lazygit External Editor & TUI Suspension Research

**Research Date**: January 2026  
**Lazygit Commit**: `80dd695d7a8d32714603f5a6307f26f589802b1d`  
**Repository**: [jesseduffield/lazygit](https://github.com/jesseduffield/lazygit)

---

## Overview

Lazygit handles external editor integration and interactive commands (like `git rebase -i`, commit editing, etc.) by **suspending the TUI**, letting the external command take over the terminal, and then **resuming the TUI** when the command completes.

This document details the exact patterns and code used to implement this feature.

---

## Architecture Overview

```
User Action (e.g., edit commit message)
    ↓
Controller calls RunSubprocessAndRefresh()
    ↓
Suspend TUI (pause rendering, clear screen)
    ↓
Run external command with inherited stdin/stdout/stderr
    ↓
Resume TUI (restore terminal state, re-engage rendering)
    ↓
Refresh UI with new state
```

---

## Core Components

### 1. Main Subprocess Execution Flow

**File**: [`pkg/gui/gui.go`](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/gui/gui.go#L914-L990)

#### `runSubprocessWithSuspenseAndRefresh()`
```go
func (gui *Gui) runSubprocessWithSuspenseAndRefresh(subprocess *oscommands.CmdObj) error {
	_, err := gui.runSubprocessWithSuspense(subprocess)
	if err != nil {
		return err
	}

	gui.c.Refresh(types.RefreshOptions{Mode: types.ASYNC})

	return nil
}
```

**Purpose**: Runs a subprocess with TUI suspension and automatically refreshes the UI afterward.

#### `runSubprocessWithSuspense()`
```go
func (gui *Gui) runSubprocessWithSuspense(subprocess *oscommands.CmdObj) (bool, error) {
	gui.Mutexes.SubprocessMutex.Lock()
	defer gui.Mutexes.SubprocessMutex.Unlock()

	if err := gui.suspend(); err != nil {
		return false, err
	}

	cmdErr := gui.runSubprocess(subprocess)

	if err := gui.resume(); err != nil {
		return false, err
	}

	if cmdErr != nil {
		return false, cmdErr
	}

	return true, nil
}
```

**Key Points**:
- Uses a **mutex** to prevent concurrent subprocess execution
- Calls `suspend()` before running the command
- Calls `resume()` after the command completes
- Returns `(success bool, error)`

#### `suspend()`
```go
func (gui *Gui) suspend() error {
	if err := gui.g.Suspend(); err != nil {
		return err
	}

	gui.BackgroundRoutineMgr.PauseBackgroundRefreshes(true)
	return nil
}
```

**What it does**:
1. Calls `gui.g.Suspend()` on the gocui GUI object
2. Pauses all background refresh routines (prevents concurrent state updates)

#### `resume()`
```go
func (gui *Gui) resume() error {
	if err := gui.g.Resume(); err != nil {
		return err
	}

	gui.BackgroundRoutineMgr.PauseBackgroundRefreshes(false)
	return nil
}
```

**What it does**:
1. Calls `gui.g.Resume()` on the gocui GUI object
2. Resumes background refresh routines

#### `runSubprocess()`
```go
func (gui *Gui) runSubprocess(cmdObj *oscommands.CmdObj) error {
	gui.LogCommand(cmdObj.ToString(), true)

	subprocess := cmdObj.GetCmd()
	subprocess.Stdout = os.Stdout
	subprocess.Stderr = os.Stderr
	subprocess.Stdin = os.Stdin

	fmt.Fprintf(os.Stdout, "\n%s\n\n", style.FgBlue.Sprint("+ "+strings.Join(subprocess.Args, " ")))

	err := subprocess.Run()

	subprocess.Stdout = io.Discard
	subprocess.Stderr = io.Discard
	subprocess.Stdin = nil

	if gui.integrationTest == nil && (gui.Config.GetUserConfig().PromptToReturnFromSubprocess || err != nil) {
		fmt.Fprintf(os.Stdout, "\n%s", style.FgGreen.Sprint(gui.Tr.PressEnterToReturn))

		// scan to buffer to prevent run unintentional operations when TUI resumes.
		var buffer string
		_, _ = fmt.Scanln(&buffer) // wait for enter press
	}

	return err
}
```

**Key Points**:
- **Inherits stdin/stdout/stderr** from the parent process (allows user interaction)
- Prints the command being executed in blue
- Optionally waits for user to press Enter before returning
- Discards output streams after command completes (prevents interference with TUI)

---

### 2. Gocui Library Integration

**File**: [`vendor/github.com/jesseduffield/gocui/gui.go`](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/vendor/github.com/jesseduffield/gocui/gui.go)

Lazygit uses the **gocui** library (custom fork by Jesse Duffield) which wraps tcell.

#### `Suspend()` in gocui
```go
func (g *Gui) Suspend() error {
	g.suspendedMutex.Lock()
	defer g.suspendedMutex.Unlock()

	if g.suspended {
		return errors.New("Already suspended")
	}

	g.suspended = true

	return g.screen.Suspend()
}
```

#### `Resume()` in gocui
```go
func (g *Gui) Resume() error {
	g.suspendedMutex.Lock()
	defer g.suspendedMutex.Unlock()

	if !g.suspended {
		return errors.New("Cannot resume because we are not suspended")
	}

	g.suspended = false

	return g.screen.Resume()
}
```

**What gocui does**:
- Delegates to the underlying screen implementation (tcell)
- Maintains a `suspended` flag to prevent double-suspension

---

### 3. Tcell Terminal Handling

**File**: [`vendor/github.com/gdamore/tcell/v2/tscreen.go`](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/vendor/github.com/gdamore/tcell/v2/tscreen.go)

#### `Suspend()` in tcell
```go
func (t *tScreen) Suspend() error {
	t.disengage()
	return nil
}
```

#### `Resume()` in tcell
```go
func (t *tScreen) Resume() error {
	return t.engage()
}
```

**What tcell does**:
- `disengage()`: Restores terminal to normal mode (disables raw mode, restores cursor, etc.)
- `engage()`: Puts terminal back into raw mode for TUI rendering

---

### 4. Editor Integration

**File**: [`pkg/gui/controllers/helpers/files_helper.go`](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/gui/controllers/helpers/files_helper.go#L63-L71)

```go
func (self *FilesHelper) callEditor(cmdStr string, suspend bool) error {
	if suspend {
		return self.c.RunSubprocessAndRefresh(
			self.c.OS().Cmd.NewShell(cmdStr, self.c.UserConfig().OS.ShellFunctionsFile),
		)
	}

	return self.c.OS().Cmd.NewShell(cmdStr, self.c.UserConfig().OS.ShellFunctionsFile).Run()
}
```

**Key Points**:
- Takes a `suspend` boolean parameter
- If `suspend=true`: Uses `RunSubprocessAndRefresh()` (suspends TUI)
- If `suspend=false`: Runs directly without suspension (for GUI editors like VSCode)

#### Editor-Specific Suspend Behavior

**File**: [`pkg/config/editor_presets.go`](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/config/editor_presets.go)

Different editors have different suspend requirements:

```go
presets := map[string]*editPreset{
	// Terminal editors - SUSPEND = true
	"vim":  standardTerminalEditorPreset("vim"),      // suspend: true
	"nvim": standardTerminalEditorPreset("nvim"),     // suspend: true
	"nano": standardTerminalEditorPreset("nano"),     // suspend: true
	"helix": {
		editTemplate:              "helix -- {{filename}}",
		editAtLineTemplate:        "helix -- {{filename}}:{{line}}",
		editAtLineAndWaitTemplate: "helix -- {{filename}}:{{line}}",
		openDirInEditorTemplate:   "helix -- {{dir}}",
		suspend:                   returnBool(true),
	},

	// GUI editors - SUSPEND = false
	"vscode": {
		editTemplate:              "code --reuse-window -- {{filename}}",
		editAtLineTemplate:        "code --reuse-window --goto -- {{filename}}:{{line}}",
		editAtLineAndWaitTemplate: "code --reuse-window --goto --wait -- {{filename}}:{{line}}",
		openDirInEditorTemplate:   "code -- {{dir}}",
		suspend:                   returnBool(false),
	},
	"sublime": {
		editTemplate:              "subl -- {{filename}}",
		editAtLineTemplate:        "subl -- {{filename}}:{{line}}",
		editAtLineAndWaitTemplate: "subl --wait -- {{filename}}:{{line}}",
		openDirInEditorTemplate:   "subl -- {{dir}}",
		suspend:                   returnBool(false),
	},
}
```

**Why the difference?**
- **Terminal editors** (vim, nano, helix): Need TUI suspension because they take over the terminal
- **GUI editors** (VSCode, Sublime): Don't need suspension because they open in separate windows

#### Template System

```go
func GetEditTemplate(shell string, osConfig *OSConfig, guessDefaultEditor func() string) (string, bool) {
	preset := getPreset(shell, osConfig, guessDefaultEditor)
	template := osConfig.Edit
	if template == "" {
		template = preset.editTemplate
	}

	return template, getEditInTerminal(osConfig, preset)
}
```

**Returns**: `(cmdTemplate string, shouldSuspend bool)`

---

### 5. Signal Handling (Unix/Linux)

**File**: [`pkg/gui/controllers/helpers/signal_handling.go`](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/gui/controllers/helpers/signal_handling.go)

Handles the case where user suspends lazygit with `Ctrl+Z`:

```go
func sendStopSignal() error {
	return syscall.Kill(0, syscall.SIGSTOP)
}

func setForegroundPgrp() error {
	fd, err := unix.Open("/dev/tty", unix.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)

	pgid := syscall.Getpgrp()

	return unix.IoctlSetPointerInt(fd, unix.TIOCSPGRP, pgid)
}

func handleResumeSignal(log *logrus.Entry, onResume func() error) {
	if err := setForegroundPgrp(); err != nil {
		log.Warning(err)
		return
	}

	if err := onResume(); err != nil {
		log.Warning(err)
	}
}

func installResumeSignalHandler(log *logrus.Entry, onResume func() error) {
	go func() {
		sigs := make(chan os.Signal, 1)
		signal.Notify(sigs, syscall.SIGCONT)

		for sig := range sigs {
			switch sig {
			case syscall.SIGCONT:
				handleResumeSignal(log, onResume)
			}
		}
	}()
}
```

**What it does**:
1. When user presses `Ctrl+Z`, the app receives `SIGSTOP`
2. A goroutine listens for `SIGCONT` (resume signal)
3. When resumed, it:
   - Sets the process group as foreground (via `TIOCSPGRP` ioctl)
   - Calls the `onResume()` callback to restore the TUI

**Windows version** (`signal_handling_windows.go`):
```go
func canSuspendApp() bool {
	return false
}

func sendStopSignal() error {
	return nil
}

func installResumeSignalHandler(log *logrus.Entry, onResume func() error) {
}
```

Windows doesn't support SIGSTOP/SIGCONT, so suspension is disabled.

---

## Usage Patterns

### Pattern 1: Edit File with Suspension

```go
// From files_helper.go
func (self *FilesHelper) EditFiles(filenames []string) error {
	absPaths := lo.Map(filenames, func(filename string, _ int) string {
		absPath, err := filepath.Abs(filename)
		if err != nil {
			return filename
		}
		return absPath
	})
	cmdStr, suspend := self.c.Git().File.GetEditCmdStr(absPaths)
	return self.callEditor(cmdStr, suspend)
}
```

**Flow**:
1. Get absolute paths of files
2. Get editor command template and suspend flag
3. Call editor with appropriate suspension behavior

### Pattern 2: Edit at Specific Line

```go
func (self *FilesHelper) EditFileAtLine(filename string, lineNumber int) error {
	absPath, err := filepath.Abs(filename)
	if err != nil {
		return err
	}
	cmdStr, suspend := self.c.Git().File.GetEditAtLineCmdStr(absPath, lineNumber)
	return self.callEditor(cmdStr, suspend)
}
```

### Pattern 3: Always Suspend (Wait for Editor)

```go
func (self *FilesHelper) EditFileAtLineAndWait(filename string, lineNumber int) error {
	absPath, err := filepath.Abs(filename)
	if err != nil {
		return err
	}
	cmdStr := self.c.Git().File.GetEditAtLineAndWaitCmdStr(absPath, lineNumber)

	// Always suspend, regardless of the value of the suspend config,
	// since we want to prevent interacting with the UI until the editor
	// returns, even if the editor doesn't use the terminal
	return self.callEditor(cmdStr, true)
}
```

---

## Key Design Decisions

### 1. **Mutex Protection**
- `SubprocessMutex` prevents concurrent subprocess execution
- Ensures only one external command runs at a time

### 2. **Background Routine Pausing**
- Pauses background refresh routines during subprocess execution
- Prevents state updates while TUI is suspended
- Resumes them after the command completes

### 3. **Stdin/Stdout/Stderr Inheritance**
- Subprocess inherits parent's I/O streams
- Allows full user interaction with external commands
- Streams are discarded after command completes to prevent interference

### 4. **Editor-Specific Configuration**
- Different editors have different suspend requirements
- Configuration is centralized in `editor_presets.go`
- Users can override with custom templates

### 5. **Optional "Press Enter to Return" Prompt**
- Gives users time to read command output
- Configurable via `PromptToReturnFromSubprocess`
- Prevents accidental key presses from affecting TUI

### 6. **Signal Handling**
- Listens for `SIGCONT` to handle user-initiated suspension (`Ctrl+Z`)
- Sets foreground process group to allow terminal input after resume
- Platform-specific (Unix only)

---

## Implementation Checklist for OpenTUI/Kajji

To implement similar functionality in our TypeScript/OpenTUI app:

- [ ] **Suspend/Resume Mechanism**
  - [ ] Implement suspend function that clears screen and restores terminal
  - [ ] Implement resume function that re-engages terminal rendering
  - [ ] Use appropriate terminal control sequences (ANSI codes or termios)

- [ ] **Subprocess Execution**
  - [ ] Create subprocess runner that inherits stdin/stdout/stderr
  - [ ] Implement mutex/lock to prevent concurrent execution
  - [ ] Add optional "press enter to continue" prompt

- [ ] **Background Task Management**
  - [ ] Pause background refresh routines during subprocess
  - [ ] Resume them after subprocess completes
  - [ ] Prevent state updates while TUI is suspended

- [ ] **Editor Integration**
  - [ ] Create editor preset system (vim, nano, vscode, etc.)
  - [ ] Determine suspend requirement per editor
  - [ ] Support custom editor templates

- [ ] **Signal Handling**
  - [ ] Listen for SIGCONT (resume signal)
  - [ ] Handle Ctrl+Z suspension gracefully
  - [ ] Set foreground process group on resume (Unix)

- [ ] **Configuration**
  - [ ] Allow users to override editor presets
  - [ ] Support custom suspend behavior
  - [ ] Make "press enter" prompt configurable

---

## Relevant Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Main subprocess flow | `pkg/gui/gui.go` | [914-990](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/gui/gui.go#L914-L990) |
| Editor integration | `pkg/gui/controllers/helpers/files_helper.go` | [63-71](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/gui/controllers/helpers/files_helper.go#L63-L71) |
| Editor presets | `pkg/config/editor_presets.go` | [1-195](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/config/editor_presets.go) |
| Signal handling | `pkg/gui/controllers/helpers/signal_handling.go` | [1-60](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/gui/controllers/helpers/signal_handling.go) |
| Suspend/Resume helper | `pkg/gui/controllers/helpers/suspend_resume_helper.go` | [1-32](https://github.com/jesseduffield/lazygit/blob/80dd695d7a8d32714603f5a6307f26f589802b1d/pkg/gui/controllers/helpers/suspend_resume_helper.go) |
| Gocui integration | `vendor/github.com/jesseduffield/gocui/gui.go` | Suspend/Resume methods |
| Tcell integration | `vendor/github.com/gdamore/tcell/v2/tscreen.go` | Suspend/Resume methods |

---

## Related Technologies

- **gocui**: Custom fork of gocui by Jesse Duffield (wraps tcell)
- **tcell**: Terminal control library (handles raw mode, screen management)
- **Unix signals**: SIGSTOP, SIGCONT for suspension handling
- **ioctl**: TIOCSPGRP for setting foreground process group

---

## Notes for Implementation

1. **Terminal Control**: The key is calling `disengage()` (restore normal mode) before subprocess and `engage()` (raw mode) after
2. **Mutex Critical**: Prevent concurrent subprocess execution with proper locking
3. **Background Tasks**: Must pause all background operations during subprocess
4. **Editor Detection**: Detect editor from environment variables or config
5. **Cross-Platform**: Windows doesn't support SIGSTOP/SIGCONT, so handle gracefully
6. **User Experience**: The "press enter" prompt prevents accidental key presses from affecting the TUI

---

## References

- Lazygit Repository: https://github.com/jesseduffield/lazygit
- Gocui Library: https://github.com/jesseduffield/gocui
- Tcell Library: https://github.com/gdamore/tcell
- Unix Signal Handling: https://man7.org/linux/man-pages/man7/signal.7.html
