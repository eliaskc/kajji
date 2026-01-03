# GitHub PR Stacking

> "Graphite in a TUI" — stacked PRs with jj's clean model.

## Philosophy: jj-native approach

Change ID is the identity, bookmark is just transport. No naming ceremony required.

- `jj git push --change <rev>` auto-creates bookmark from change ID (e.g., `push-kywxvzoq`)
- Select commit → press `p` → PR exists
- Stacking builds on this: push each change in stack, jj auto-names them

## Overview

Leverage jj's bookmark model and clean rebasing to manage stacked PRs on GitHub. Three main flows:

1. **Single PR** — Select any commit, push + create PR (no bookmark needed)
2. **Stack creation** — Select a commit, create PRs for all changes between it and main
3. **Stack reconciliation** — On fetch, detect merged PRs and offer to update local state

## Single PR Flow

### Trigger
User selects any commit and presses `p`.

### Logic
1. Run `jj git push --change <selected>` — auto-creates bookmark from change ID
2. Run `gh pr create --head <auto-bookmark>`
3. (optional) Open PR in browser

No bookmark required. No naming modal. Just "this commit should be a PR."

## Stack Creation Flow

### Trigger
User selects a commit and invokes "Create PR stack" (keybind TBD, maybe `shift+P`).

### Logic
1. Find all commits between selection and main:
   ```
   jj log -r 'ancestors(selection) & descendants(main)'
   ```
2. Order them by ancestry (main → selection)
3. Push each change: `jj git push --change <rev>` (auto-creates bookmarks)
4. Show preview modal:
   ```
   Create PR stack:
   
   [1] push-abc123 → main         (base)
   [2] push-def456 → push-abc123
   [3] push-ghi789 → push-def456
   
   All PRs will be created as drafts.
   
   [Enter] Create  [Esc] Cancel
   ```
5. On confirm, create PRs via `gh pr create --draft --base <parent>`
6. Show progress/results

### Naming
jj auto-generates bookmark names from change IDs. If user has manually named bookmarks, those are used instead. No naming ceremony required.

## Stack Reconciliation Flow

### Trigger
On `jj git fetch` or manual "Sync stack" command (`S`).

### Detection
1. List local bookmarks that have open PRs: `gh pr list --state open`
2. Check which PRs have been merged since last sync
3. Identify affected stacks

### Example: Mid-stack merge
If PR #2 of 4 is merged:
- Before: `main ← #1 ← #2 ← #3 ← #4`
- After merge: `main` now contains #2's changes
- Action: Update #3 to target #1 (skip merged #2), rebase #3 and #4

### Semi-automatic approach (Phase 3)
Since jj makes rebasing trivial and doesn't require clean working copies, reconciliation can be semi-automatic:
- Detect stale stacks on refresh
- Show inline notification: "Stack has merged PRs. Press `S` to reconcile."
- One keypress applies the fix

### Full modal (later, for complex cases)
```
Stack changes detected:

push-def456 was merged to main.

Proposed updates:
  - Rebase push-ghi789 onto push-abc123 (was: push-def456)
  - Update PR #3 base
  - Force push remaining stack

[Enter] Apply  [Esc] Cancel  [d] Show diff
```

## Draft PR Strategy

All stacked PRs created as **drafts** by default. Rationale:
- Encourages merging in order (base → top)
- Prevents accidental merge of PR #4 before #1-3
- User marks ready when appropriate

If merged out of order (e.g., #2 merged before #1), reconciliation handles it but the result may be suboptimal (changes accumulate in remaining PRs).

## Conflict Handling

jj allows conflicts to persist in the working copy. When rebasing a stack:
- If conflicts occur, jj records them but continues
- Show clear warning in modal:
  ```
  ⚠ Conflicts in feature-auth-test:
    - src/auth.ts
    - src/utils.ts
  
  Rebase completed with conflicts. Resolve before pushing.
  ```
- Block force-push until conflicts resolved (or provide override)

## Commands

| Key | Context | Action |
|-----|---------|--------|
| `p` | Log/Bookmarks | Push change + create PR (single commit) |
| `P` | Log/Bookmarks | Create PR stack from selection |
| `S` | Log/Bookmarks | Sync/reconcile stack |
| `gp` | Log/Bookmarks | Open PR in browser (if exists) |

## Implementation Phases

### Phase 0: Single PR (jj-native)
- [ ] `p` on any commit pushes + creates PR
- [ ] `jj git push --change` for auto-bookmark
- [ ] `gh pr create` integration
- [ ] Foundation for stacking

### Phase 1: Stack Creation
- [ ] Revset query to find stack commits
- [ ] Push each change (auto-bookmarks)
- [ ] Preview modal with stack visualization
- [ ] `gh pr create --draft --base <parent>` for each
- [ ] Progress feedback

### Phase 2: Stack Visualization
- [ ] Show PR status in bookmark list (draft/ready/merged)
- [ ] CI status indicator
- [ ] Stack relationship lines in log view

### Phase 3: Stack Reconciliation
- [ ] Detect stale stacks on refresh (merged PRs)
- [ ] One-keypress fix: offer to rebase + update PR targets
- [ ] Semi-automatic for common cases
- [ ] (Later) Full preview modal for complex cases

### Phase 4: Polish
- [ ] Handle edge cases (orphaned PRs, conflicts)
- [ ] Undo support for stack operations
- [ ] Batch operations (mark all ready, close stack)

## Dependencies

- `gh` CLI must be installed and authenticated
- Repository must have GitHub remote
- jj must be configured with git backend

## Prior Art

- [Graphite](https://graphite.dev/) — Commercial stacking tool
- [gh-stack](https://github.com/timothyandrew/gh-stack) — CLI for GitHub stacked PRs  
- [spr](https://github.com/ejoffe/spr) — Stacked PRs for GitHub
- [jj's native GitHub support](https://github.com/martinvonz/jj/issues/1039) — Upstream discussion

## Open Questions

- How to handle force-push failures (protected branches, etc.)?
- Integration with jj's eventual native GitHub support?
- Custom bookmark naming: allow user to rename auto-generated `push-xxx` bookmarks?
