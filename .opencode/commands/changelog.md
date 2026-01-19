---
description: Generate release notes and update CHANGELOG.md
---

Generate release notes and update CHANGELOG.md.

**Just do it.** Don't ask for confirmation — run the commands, generate the notes, update the file.

## Steps

1. Get latest tag: `git tag --sort=-version:refname | head -1`
2. Get commits with hashes: `git log <tag>..HEAD --format='%h|%s|%b---'`
3. Get version from package.json
4. For each commit, gather context progressively (see below)
5. Generate release notes with references
6. Prepend to CHANGELOG.md
7. Check README.md — update feature checklists, fix broken links
8. Bump version in package.json

Only ask user if: no tags exist, or commit range is ambiguous.

## Progressive Context Gathering

Start minimal, dig deeper only when needed:

### Level 1: Commit message
```bash
git log <tag>..HEAD --format='%h|%s'
```
Usually enough. Move on if meaning is clear.

### Level 2: File summary
```bash
git show --stat <hash>
```
Use when: commit message is vague ("fix bug", "update code") or scope unclear.

### Level 3: Diff
```bash
git show <hash>
```
Use when: need to understand what actually changed (breaking changes, complex fixes).

### Level 4: PR context
If commit message contains `(#123)` or similar:
```bash
gh pr view 123 --json title,body,labels
```
Use when: commit message references PR and you need more context (especially for squash merges).

## References in Output

Include references for traceability:

```markdown
### new
- rebase command with revision picker ([`a1b2c3d`](../../commit/a1b2c3d))

### fixed
- divergent commits now handled correctly ([#42](../../pull/42))
```

Rules:
- Always include commit hash as link: [`hash`](../../commit/hash)
- If PR exists, prefer PR link: [#123](../../pull/123)
- For squash merges, use the PR link
- Multiple commits for one feature? Link the most relevant or the PR

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
- description of breaking change ([#123](../../pull/123))

### new
- feature description (`keybind` if applicable) ([`abc123`](../../commit/abc123))

### improved
- prefix: description ([`def456`](../../commit/def456))

### fixed
- prefix: description ([#789](../../pull/789))
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
a1b2c3d feat: add rebase command (r) with revision picker
b2c3d4e feat: improve status bar overflow handling (#42)
c3d4e5f fix(perf): load redo/undo ops before modal display to avoid flash
d4e5f6g fix: handle divergent commits correctly
```

**Release notes:**
```markdown
## 0.2.0

### new
- rebase command (`r`) with revision picker ([`a1b2c3d`](../../commit/a1b2c3d))

### improved
- ux: status bar truncates gracefully, commands grouped by context ([#42](../../pull/42))

### fixed
- divergent commits now handled correctly ([`d4e5f6g`](../../commit/d4e5f6g))
- perf: undo/redo modal loads data before display ([`c3d4e5f`](../../commit/c3d4e5f))
```

## Common Mistakes to Avoid

- Don't include `docs:`, `test:`, `chore:` commits
- Don't use Title Case
- Don't write paragraphs — one line per bullet
- Don't duplicate similar changes — consolidate them (link all related commits/PRs)
- Don't use "now" as in "now supports X" — just say "supports X"
- Don't skip references — every entry needs a link
- Don't guess at changes — use progressive context gathering when unclear
