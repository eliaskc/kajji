# GitHub PR Stacking

> "Graphite in a TUI" — stacked PRs with jj's clean model.

## Overview

Leverage jj's bookmark model and clean rebasing to manage stacked PRs on GitHub. Two main flows:

1. **Stack creation** — Select a commit, create PRs for all bookmarks between it and main
2. **Stack reconciliation** — On fetch, detect merged PRs and offer to update local state

## Stack Creation Flow

### Trigger
User selects a commit and invokes "Create PR stack" (keybind TBD, maybe `P`).

### Logic
1. Find all bookmarks between selection and main:
   ```
   jj log -r 'ancestors(selection) & descendants(main) & bookmarks()'
   ```
2. Order them by ancestry (main → selection)
3. Show preview modal:
   ```
   Create PR stack:
   
   [1] feature-auth      → main         (base)
   [2] feature-auth-ui   → feature-auth
   [3] feature-auth-test → feature-auth-ui
   
   All PRs will be created as drafts.
   
   [Enter] Create  [Esc] Cancel
   ```
4. On confirm, create PRs via `gh pr create --draft --base <parent>`
5. Show progress/results

### Naming
Use existing bookmark names. User is responsible for meaningful names. If a commit in the chain has no bookmark, warn and skip or prompt to create one.

## Stack Reconciliation Flow

### Trigger
On `jj git fetch` or manual "Sync stack" command.

### Detection
1. List local bookmarks that have open PRs: `gh pr list --state open`
2. Check which PRs have been merged since last sync
3. Identify affected stacks

### Example: Mid-stack merge
If PR #2 of 4 is merged:
- Before: `main ← #1 ← #2 ← #3 ← #4`
- After merge: `main` now contains #2's changes
- Action: Update #3 to target #1 (skip merged #2), rebase #3 and #4

### Modal Preview
```
Stack changes detected:

feature-auth-ui was merged to main.

Proposed updates:
  - Rebase feature-auth-test onto feature-auth (was: feature-auth-ui)
  - Update PR #3 base: feature-auth-ui → feature-auth
  - Force push: feature-auth-test, feature-auth-final

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
| `P` | Log/Bookmarks | Create PR stack from selection |
| `S` | Log/Bookmarks | Sync/reconcile stack |
| `gp` | Log/Bookmarks | Open PR in browser (if exists) |

## Implementation Phases

### Phase 1: Stack Creation
- [ ] Revset query to find stack bookmarks
- [ ] Preview modal with stack visualization
- [ ] `gh pr create` integration
- [ ] Progress feedback

### Phase 2: Stack Visualization
- [ ] Show PR status in bookmark list (draft/ready/merged)
- [ ] CI status indicator
- [ ] Stack relationship lines in log view

### Phase 3: Stack Reconciliation
- [ ] Detect merged PRs on fetch
- [ ] Compute required rebases
- [ ] Preview modal for changes
- [ ] Execute rebase + force push

### Phase 4: Polish
- [ ] Handle edge cases (no bookmark, orphaned PRs)
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

- Should we track stack metadata locally (e.g., `.jj/stacks.json`) or derive from PR state?
- How to handle force-push failures (protected branches, etc.)?
- Integration with jj's eventual native GitHub support?
