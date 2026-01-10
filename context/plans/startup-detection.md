# Startup: Non-jj Repo Detection

**Status**: Implemented
**Priority**: High
**Goal**: Graceful handling when kajji is launched outside a jj repository

---

## Implementation Summary

**Files created:**
- `src/utils/state.ts` — State file management (`~/.config/kajji/state.json`), recent repos tracking
- `src/utils/repo-check.ts` — Repo detection (`.jj/`, `.git/`) and init functions
- `src/components/StartupScreen.tsx` — Startup UI with two modes

**Files modified:**
- `src/index.tsx` — Root component conditionally renders StartupScreen or App
- `src/context/sync.tsx` — Tracks repo on successful initial load

**Decisions made:**
- State location: `~/.config/kajji/state.json` (Option 1)
- Recent repos: 10 max, sorted by last opened
- Repo switching: Uses `setRepoPath()` + Solid reactivity (Option A, simplified)
- Detection: Simple `.jj/` directory check (faster than `jj root` command)

---

## Original Planning

### Previous Behavior

When not in a jj repo, kajji crashed or showed cryptic jj errors.

---

### Proposed Behavior

### Detection Flow

1. On startup, run `jj root` (or similar) to check if in a jj repo
2. If yes → normal startup
3. If no → show helpful startup screen

### Startup Screen Options

**If `.git` directory found:**
```
Not a jj repository, but Git repo detected.

  [i] Initialize jj here (jj git init)
  [q] Quit

Tip: jj can coexist with git. Your git history will be imported.
```

**If no VCS found:**
```
Not in a jj repository.

  Recent repositories:
    ~/projects/kajji
    ~/work/myapp

  [1-9] Open recent repo
  [q] Quit
```

---

## Open Questions

### State persistence location

Where to store recent repos list?

Options:
1. `~/.config/kajji/state.json` — already mentioned for version check state
2. `~/.local/state/kajji/recent.json` — XDG state directory
3. `~/.kajji/state.json` — simpler, single dotfile

Leaning toward option 1 for consistency with planned version check feature.

### State file format

```json
{
  "recentRepos": [
    { "path": "/Users/foo/projects/kajji", "lastOpened": "2024-01-10T..." },
    { "path": "/Users/foo/work/myapp", "lastOpened": "2024-01-09T..." }
  ],
  "lastUpdateCheck": "2024-01-10T...",
  "dismissedVersion": null
}
```

### How many recent repos to track?

5? 10? Configurable?

### Should we auto-cd or spawn new shell?

When user selects a recent repo:
- Option A: Change directory and restart kajji in that context
- Option B: Show path and let user cd manually
- Option C: Open new terminal tab/window in that directory (platform-specific)

Option A seems most useful but need to verify it works correctly.

---

## Implementation Notes

- Check `jj root` exit code — non-zero means not in repo
- Check for `.git` directory with `fs.existsSync('.git')`
- State file should be created on first successful repo open, not on failed startup
