# lazyjj Reference

> Rust TUI for jj built with Ratatui  
> Repo: https://github.com/Cretezy/lazyjj  
> Relevance: Bookmark ops, remote operations, config patterns

---

## Bookmark Operations

### Data Model
```typescript
interface Bookmark {
  name: string
  remote?: string  // undefined = local, "origin" = remote
  present: boolean // exists at target
  timestamp: number
}
// Display: "name" or "name@remote"
```

### Operations & Keybindings

| Key | Operation | Command |
|-----|-----------|---------|
| `c` | Create | `jj bookmark create <name>` |
| `r` | Rename | `jj bookmark rename <old> <new>` |
| `d` | Delete | `jj bookmark delete <name>` |
| `f` | Forget | `jj bookmark forget <name>` |
| `t` | Track | `jj bookmark track <name>@<remote>` |
| `T` | Untrack | `jj bookmark untrack <name>@<remote>` |
| `a` | Show all | Toggle `--all-remotes` flag |

### UI Pattern
- TextArea modal for name input (create, rename)
- Confirmation dialog for destructive ops (delete, forget)
- List with drill-down into commits

---

## Remote Operations

### Git Fetch
```typescript
gitFetch(allRemotes: boolean): Promise<string> {
  const args = ["git", "fetch"]
  if (allRemotes) args.push("--all-remotes")
  return executeJJ(args)
}
```

| Key | Action |
|-----|--------|
| `f` | Fetch current remote |
| `F` | Fetch all remotes |

### Git Push
```typescript
gitPush(allBookmarks: boolean, revision?: string): Promise<string> {
  const args = ["git", "push"]
  if (allBookmarks) {
    args.push("--all")  // Includes new bookmarks
  } else if (revision) {
    args.push("-r", revision)
  }
  return executeJJ(args)
}
```

| Key | Action |
|-----|--------|
| `p` | Push bookmarks at current revision |
| `P` | Push all bookmarks (including new) |

**Note:** jj's push is already safe by default (like `git push --force-with-lease`). No `--force` flag needed.

---

## Squash Pattern

lazyjj uses single-selection for squash targets:

```typescript
// User navigates to target, presses 's'
squash(targetRevision: string, ignoreImmutable: boolean) {
  const args = ["squash", "--into", targetRevision]
  if (ignoreImmutable) args.push("--ignore-immutable")
  return executeJJ(args)
}
```

**Flow:**
1. Navigate to target commit
2. Press `s` (or `S` for ignore-immutable)
3. Confirmation dialog
4. Execute squash

---

## Config Integration

lazyjj reads from jj's config (not a separate file):

```toml
# In ~/.jjconfig.toml or .jj/repo/config.toml

[lazyjj.keybinds.log]
new = "n"
edit = ["e", "enter"]  # Multiple triggers
describe = "d"
abandon = false        # Disable keybind

[lazyjj.highlight-color]
# Single configurable highlight color
```

---

## Architecture

```
┌─────────────────────────────────────┐
│ UI Layer (Tabs)                     │
│ - State management                  │
│ - Modal dialogs                     │
│ - Refresh logic                     │
└──────────────┬──────────────────────┘
               │ calls
               ↓
┌─────────────────────────────────────┐
│ Commander Layer                     │
│ - Pure command execution            │
│ - No UI state                       │
│ - Returns Result<String>            │
└──────────────┬──────────────────────┘
               │ executes
               ↓
┌─────────────────────────────────────┐
│ jj CLI                              │
└─────────────────────────────────────┘
```

---

## Key Takeaways for lazyjuju

1. **Template-based parsing** - Use jj templates for structured output
2. **Single selection for targets** - Navigate to target, then act
3. **Modal dialogs** - TextArea for input, confirm for destructive ops
4. **jj config integration** - Store settings in jj's config
5. **Multiple keybind triggers** - Support arrays like `["e", "enter"]`
6. **Keybind disable** - `action = false` to disable
