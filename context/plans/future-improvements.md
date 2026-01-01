# Future Improvements

> Planning notes for infrastructure and UX improvements.

---

## Configuration System

**Status**: Not started
**Priority**: High

### Current State

No user configuration. Theme is hardcoded toggle, keybindings are hardcoded.

### Goals

Design a configuration system inspired by [jjui's approach](https://github.com/idursun/jjui/wiki/Configuration):

- **Location**: `~/.config/lazyjuju/config.toml` (respects XDG_CONFIG_HOME)
- **Alternative**: Could also read from `[lazyjuju]` section in jj's config

### Proposed Structure

```toml
# ~/.config/lazyjuju/config.toml

[ui]
theme = "lazygit"  # or "opencode", custom theme name

[ui.colors]
# Override specific colors
# selected = { bg = "#3a3a3a" }

[keybinds]
# Global keybinds
quit = "q"
help = "?"
refresh = "R"

[keybinds.log]
# Context-specific keybinds for log panel
# ...

[revisions]
# Override jj's default revset and template
# revset = "..."
# template = "builtin_log_compact"
```

### Reference

- jjui config: https://github.com/idursun/jjui/wiki/Configuration
- jjui default config: https://github.com/idursun/jjui/blob/main/internal/config/default/config.toml

---

## Keybinding System Improvements

**Status**: Partially implemented (registry exists, context awareness needed)
**Priority**: High

### Current State

- Command registry exists with keybinds, contexts, and categories
- All keybinds are global
- Status bar shows hints

### Improvements Needed

1. **Context-aware keybinds**
   - Keybinds should be scoped to panels (log, bookmarks, diff, etc.)
   - Same key can do different things in different panels
   - Example: `d` = describe in log panel, delete in bookmarks panel

2. **Status bar visibility control**
   - Each keybind should have a `showInStatusBar: boolean` property
   - Important keybinds shown by default
   - Navigation keybinds (j/k/g/G) hidden to reduce noise

3. **Help modal integration**
   - Filter by context
   - Show/hide based on visibility property
   - Group by category

### Proposed Command Interface

```typescript
interface Command {
  id: string
  title: string
  keybind: string
  context: "global" | "log" | "bookmarks" | "diff" | "files" | "modal"
  category: string
  onSelect: () => void
  // New properties:
  showInStatusBar?: boolean  // default: true
  showInHelp?: boolean       // default: true
}
```

---

## Build & Release Flows

**Status**: Not started
**Priority**: Medium

### Goals

Enable users to install lazyjuju easily via:

1. **bunx** - Zero-install execution
2. **Homebrew** - macOS/Linux package manager
3. **npm/pnpm/yarn** - Node ecosystem

### Homebrew

Create a Homebrew tap:

```bash
brew tap YOUR_USERNAME/lazyjuju
brew install lazyjuju
```

Requirements:
- Create `homebrew-lazyjuju` repo with formula
- Binary releases on GitHub
- Formula that downloads and installs binary

### bunx / npx

Publish to npm:

```bash
bunx lazyjuju
# or
npx lazyjuju
```

Requirements:
- Add `"bin": { "lazyjuju": "./bin/lazyjuju.js", "lj": "./bin/lazyjuju.js" }` to package.json
- Create entry script that works with Bun

### GitHub Releases

Automated releases with:
- Semantic versioning (or date-based: `2026.01.15`)
- Changelog generation
- Binary builds for macOS/Linux (arm64, x64)

### CI/CD

```yaml
# .github/workflows/release.yml
on:
  push:
    tags: ["v*"]
jobs:
  release:
    # Build binaries
    # Create GitHub release
    # Publish to npm
    # Update Homebrew formula
```

---

## Tasks

- [ ] Design configuration schema
- [ ] Implement config loader (TOML parsing)
- [ ] Add context scoping to keybind system
- [ ] Add showInStatusBar/showInHelp to commands
- [ ] Set up npm package structure
- [ ] Create GitHub Actions workflow for releases
- [ ] Set up Homebrew tap
