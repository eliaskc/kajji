# Changelog Skill

Generate release notes and update CHANGELOG.md.

**Just do it.** Don't ask for confirmation — run the commands, generate the notes, update the file.

## Steps

1. Get latest tag: `git tag --sort=-version:refname | head -1`
2. Get commits: `git log <tag>..HEAD --format='%s%n%b---'`
3. Get version from package.json
4. Generate release notes (see format below)
5. Prepend to CHANGELOG.md

Only ask user if: no tags exist, or commit range is ambiguous.

## Release Notes Format

### Style

- lowercase throughout
- concise bullets (one line each)
- no marketing speak, no "exciting", no emojis
- focus on what changed, not how

### Sections (in order, skip if empty)

```markdown
## x.y.z

### breaking
- description of breaking change

### new
- feature description (`keybind` if applicable)

### improved
- prefix: description

### fixed
- prefix: description (or no prefix if obvious)
```

### Prefixes for `improved` and `fixed`

| Prefix | When to use |
|--------|-------------|
| `ux:` | user interaction (inputs, feedback, selection, modals) |
| `layout:` | panel sizing, responsive behavior, visual structure |
| `theming:` | colors, borders, styling tokens |
| `perf:` | speed, loading, flash prevention |
| `a11y:` | accessibility |

No prefixes needed for `new` section.

### Categorization Rules

| Commit type | Section | Notes |
|-------------|---------|-------|
| `BREAKING CHANGE` in body | `breaking` | Always first |
| `feat!:` or `fix!:` | `breaking` | The `!` indicates breaking |
| `feat:` adding new capability | `new` | Wholly new feature |
| `feat:` enhancing existing | `improved` | Enhancement to existing feature |
| `fix:` | `fixed` | Bug fixes |
| `perf:` | `fixed` | Use `perf:` prefix |
| `docs:`, `test:`, `chore:` | skip | Not user-facing |

### CHANGELOG.md Structure

Prepend the new version, keep existing history:
```markdown
# Changelog

## x.y.z (new)

### new
- ...

### improved
- ...

### fixed
- ...

## previous version (existing)

...
```

## Example

**Commits:**
```
feat: add rebase command (r) with revision picker
feat: improve status bar overflow handling
- Split into context commands (left, truncates) and global commands (right, fixed)
fix(perf): load redo/undo ops before modal display to avoid flash
fix: handle divergent commits correctly
```

**Release notes:**
```markdown
## 0.2.0

### new
- rebase command (`r`) with revision picker

### improved
- ux: status bar truncates gracefully, commands grouped by context

### fixed
- divergent commits now handled correctly (uses commit ID)
- perf: undo/redo modal loads data before display (no flash)
```

## Common Mistakes to Avoid

- Don't include `docs:`, `test:`, `chore:` commits
- Don't use Title Case
- Don't write paragraphs — one line per bullet
- Don't duplicate similar changes — consolidate them
- Don't include commit hashes or PR numbers
- Don't use "now" as in "now supports X" — just say "supports X"
