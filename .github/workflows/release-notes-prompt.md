---
description: CI release-notes generator (kajji)
argument-hint: "[bump]"
---

You are running inside the `release` GitHub Actions workflow. Your job is **narrow and mechanical**: generate the changelog entry for the next release and bump the version in `package.json`. Nothing else.

**Do not** commit, push, tag, open a PR, or run `gh release ...`. The workflow handles all of that programmatically after you exit.

When you are done, just print a short summary line and stop.

## Inputs

`$1` — version bump. May be empty.

- If `$1` is `patch`, `minor`, `major`, or an explicit `x.y.z`, use it.
- If `$1` is empty or whitespace, **you decide** the bump using the semver rules below.

## Steps

1. `git tag --sort=-version:refname | head -1` — latest tag (e.g. `v0.10.3`)
2. `jq -r .version package.json` — current version
3. `git log <tag>..HEAD --format='%h|%s'` — commits since last tag. If empty, abort with a message: nothing to release.
4. For each commit, gather just enough context. Start with the subject. Escalate only when needed:
   - vague subject (`fix bug`, `update`) → `git show --stat <hash>`
   - need to confirm scope or breaking-ness → `git show <hash>`
   - subject ends with `(#NNN)` → `gh pr view NNN --json title,body,labels`
5. Decide the bump (see semver rules below) **only if `$1` is empty**.
6. Compute the new version and update `package.json` in place. Preserve formatting — replace only the `"version": "..."` field.
7. Prepend a new section to `CHANGELOG.md` in the format below. Keep all existing history untouched.
8. Print a one-line summary: `Generated changelog for vX.Y.Z (bump: <type>, N commits).`

## Semver rules

| Bump | When | Examples |
|---|---|---|
| **major** | breaking changes | removed feature, changed API, renamed command |
| **minor** | new user-facing features | new command, new modal, new keybind |
| **patch** | fixes / perf / minor improvements only | crash fix, typo, perf |

Decision order:
1. Any breaking change in the range? → major
2. Any new feature (`feat:` adding a wholly new capability)? → minor
3. Otherwise → patch

Don't default to patch — explicitly check for new features.

## CHANGELOG format

Sections in order; **skip a section if it is empty**:

```markdown
## x.y.z

### breaking
- description ([#123](../../pull/123))

### new
- feature description (`keybind` if applicable) ([`abc123`](../../commit/abc123))

### improved
- prefix: description ([`def456`](../../commit/def456))

### fixed
- prefix: description ([#789](../../pull/789))
```

### Style

- lowercase throughout
- one bullet, one line — no paragraphs
- no marketing speak, no emojis
- focus on what changed, not how
- every entry must have a reference link (commit hash or PR)
- prefer PR link if commit subject ends with `(#NNN)` (squash merges)
- consolidate duplicate/related changes — link multiple refs in one bullet

### Prefixes (for `improved` and `fixed`)

| Prefix | When |
|---|---|
| `ux:` | user interaction (inputs, feedback, modals, selection) |
| `layout:` | panel sizing, responsive behavior, visual structure |
| `theming:` | colors, borders, styling tokens |
| `perf:` | speed, loading, flash prevention |
| `a11y:` | accessibility |
| `build:` | build/release plumbing user can observe (e.g. signed binaries) |

No prefixes in the `new` section.

### Categorization

| Commit type | Section |
|---|---|
| `BREAKING CHANGE` body / `feat!:` / `fix!:` | breaking |
| `feat:` (wholly new capability) | new |
| `feat:` (enhancement to existing feature) | improved |
| `fix:` | fixed |
| `perf:` | fixed (with `perf:` prefix) |
| `docs:`, `test:`, `chore:`, `ci:` | **skip — not user-facing** |

## Constraints (CI hardening)

- Do not modify any files other than `package.json` and `CHANGELOG.md`.
- Do not run `git add`, `git commit`, `git push`, `git tag`, or any `gh pr ...` / `gh release ...` write commands. The workflow does this.
- Do not edit README.md or other docs in this run — that's a separate concern handled out-of-band.
- If the commit range is empty, exit with a clear message and do not modify any files.
- If `$1` specifies an explicit `x.y.z` that is older than or equal to the current version, abort with an error message.

## Reference example

Commits:
```
a1b2c3d feat: add rebase command (r) with revision picker
b2c3d4e feat: improve status bar overflow handling (#42)
c3d4e5f perf: load redo/undo ops before modal display
d4e5f6g fix: handle divergent commits correctly
```

Output prepended to CHANGELOG.md:
```markdown
## 0.11.0

### new
- rebase command (`r`) with revision picker ([`a1b2c3d`](../../commit/a1b2c3d))

### improved
- ux: status bar truncates gracefully ([#42](../../pull/42))

### fixed
- divergent commits handled correctly ([`d4e5f6g`](../../commit/d4e5f6g))
- perf: undo/redo modal loads data before display ([`c3d4e5f`](../../commit/c3d4e5f))
```

And `package.json` version field updated to `0.11.0`.
