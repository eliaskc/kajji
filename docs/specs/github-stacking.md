# GitHub PR Stacking

> "Graphite in a TUI" — stacked PRs with jj's clean model, open-source and free.

## Philosophy

**The log is the stack.** jj's commit graph already models stacking perfectly — bookmarks on commits in an ancestry chain are a stack. kajji doesn't need to invent a separate "stack" concept. It just needs to handle the GitHub side: opening PRs with the right bases, posting stack navigation comments, and restacking after merges.

Key principles:

- **No overhead on top of jj.** jj's log, bookmarks, and rebase are the foundation. kajji only adds the GitHub PR layer.
- **Each bookmark = one PR.** A bookmark can span multiple commits. The user places bookmarks at PR boundaries using jj natively.
- **Force-push by default.** jj users expect history rewriting (edit/squash is the core workflow). Force-push keeps the remote in sync with the jj model. Append-only updates (preserving GitHub review context) can be added later as an option.
- **Dependent stacks by default.** Each PR targets the ancestor bookmark below it. This gives reviewers clean incremental diffs. Independent mode (each PR targets trunk) can be offered when changes are unrelated.

## Overview

Three main flows, integrated into existing keybindings:

1. **Open PR** (`o`/`O`) — Create a PR, with awareness of ancestor bookmarks for stacking
2. **Submit stack** (`P` menu) — Push all bookmarks in a stack + update stack comments
3. **Sync stack** (`F` menu) — Fetch, detect merged PRs, rebase + clean up

---

## Open PR Flow

### `o` — Open with modal

When pressing `o` on a commit:

1. If a PR already exists for this bookmark → open it in browser
2. If no bookmark exists → prompt to create one (existing flow)
3. If ancestor bookmarks exist between this commit and trunk → show base picker:

```
Open Pull Request

  Target:
    > push-auth-fix (stack on ancestor)
      main

  [Enter] Select  [Esc] Cancel
```

Options:
- **Stack on ancestor** (default if ancestor bookmarks exist): `gh pr create --head <bookmark> --base <ancestor-bookmark>`
- **Target trunk**: `gh pr create --head <bookmark> --base main`

If no ancestor bookmarks exist, skip the modal — go straight to creating a PR targeting trunk (same as current flow).

On PR creation, post a stack navigation comment (see [Stack Comments](#stack-navigation-comments)).

### `O` — Quick open (no modal)

Defaults:
- Stack on nearest ancestor bookmark if one exists
- Fall back to trunk if no ancestors
- Post stack navigation comment

This is the "I know what I want, just do it" key.

### Logic

```typescript
function getBase(commit: Commit, allCommits: Commit[]): string {
  // Walk ancestors from commit toward trunk
  // Find the nearest commit with a bookmark
  // Return that bookmark name, or trunk if none found
  const ancestors = walkAncestors(commit, allCommits)
  const nearestWithBookmark = ancestors.find(c => c.bookmarks.length > 0)
  return nearestWithBookmark?.bookmarks[0] ?? 'main'
}
```

### jj Commands

```bash
# Create bookmark if needed
jj bookmark create <name> -r <rev>

# Push (first push needs explicit -b since bare push skips untracked bookmarks)
jj git push -b <bookmark>

# Open PR with correct base
gh pr create --web --head <bookmark> --base <ancestor-bookmark-or-main>
```

**Note on `jj git push` behavior:** Bare `jj git push` only pushes bookmarks that are already tracked on the remote (have been pushed at least once). First push of a bookmark requires `-b <name>`, `--change <id>`, or `--all`. This is why submit stack must use explicit `-b` flags.

---

## Submit Stack Flow

### Trigger

`P` (push menu) → `s` (submit stack entry)

The push menu is extended with stack-aware options:

```
Push options
  s  submit push-auth-fix::push-cleanup
  b  --bookmark push-auth-fix
  c  --change kywxvzoq
  a  --all
  t  --tracked
  d  --deleted
  n  --dry-run
```

If multiple stacks are detected, show one entry per stack using `bottom::top` notation:

```
  s  submit push-auth-fix::push-cleanup
  S  submit push-feature-a::push-feature-c
```

### Logic

1. Discover all bookmarks in the stack (connected ancestry chain between trunk and tips, both ancestors and descendants of `@`)
2. Push each bookmark explicitly: `jj git push -b <bookmark>` for each
3. Update stack navigation comments on all PRs in the stack

### Stack Discovery

Open question: exact revset for finding all bookmarks in a connected stack. Candidates:

```bash
# All mutable commits with bookmarks between trunk and tips
(ancestors(visible_heads()) & descendants(trunk())) & mutable() & bookmarks()

# Or more targeted: from selected commit, walk both directions
(ancestors(<rev>) | descendants(<rev>)) & mutable() & bookmarks()
```

The right approach depends on how we want to handle multiple independent stacks. To be determined during implementation.

---

## Sync Stack Flow

### Trigger

`F` (fetch menu) → `s` (sync stack entry)

The fetch menu is extended with stack-aware options:

```
Fetch options
  s  sync push-auth-fix::push-cleanup
  a  --all-remotes
  t  --tracked
  b  --branch push-auth-fix
  p  --branch glob:push-*
```

If multiple stacks, show one entry per stack:

```
  s  sync push-auth-fix::push-cleanup
  S  sync push-feature-a::push-feature-c
```

### Sync Logic

1. `jj git fetch`
2. Detect merged PRs: `gh pr list --state merged` filtered to known stack bookmarks
   - Alternative: check if remote bookmarks were deleted (less reliable — depends on GitHub branch deletion settings)
3. Show confirmation modal:

```
Stack sync: push-auth-fix::push-cleanup

  Merged:
    push-auth-fix (#42) — merged into main

  Proposed:
    - Rebase push-session onto main@origin
    - Abandon push-auth-fix
    - Delete bookmark push-auth-fix
    - Force-push remaining stack
    - Update stack comments

  [Enter] Apply  [Esc] Cancel
```

4. On confirm, execute (bottom-up for multi-merge):

```bash
# For each merged PR (bottom-up):

# 1. Rebase the next bookmark above onto trunk
#    -s cascades to all descendants, preserving relative order
jj rebase -s <next-above-merged> -d main@origin

# 2. Clean up merged change (may already be abandoned by jj)
jj abandon <merged-change-id>

# 3. Clean up bookmark
jj bookmark delete <merged-bookmark>

# After all merges processed:

# 4. Force-push remaining stack
jj git push -b <bookmark1> -b <bookmark2> ...

# 5. Update stack navigation comments
gh api ...  # update comment on each remaining PR
```

### Restack Mechanics

The key command is `jj rebase -s <source> -d <destination>`:

- `-s` (source) rebases the source commit **and all its descendants**
- Descendants maintain their relative relationships
- One command handles the entire sub-stack

Example: Stack is `main ← A ← B ← C ← D`, PR for A merges:

```
Before:  main(old) ← A ← B ← C ← D
Command: jj rebase -s B -d main@origin
After:   main(with A) ← B' ← C' ← D'
```

B moves onto new main, C stays on B, D stays on C. No need to rebase each individually.

**Multi-merge edge case:** If A and C both merge simultaneously, process bottom-up:
1. Rebase B onto main (handles A being gone)
2. Re-evaluate — C's changes are now in main, so C becomes empty
3. Abandon C, rebase D onto B

---

## Stack Navigation Comments

Posted as a **comment** on each PR in the stack (not injected into PR body). Created on PR open, updated on every submit.

### Format

```markdown
<!-- kajji:stack -->
### Stack
- **push-cleanup** #47 👈
- push-session #46
- push-auth-fix #45
- `main`

---
*Created by [kajji](https://github.com/eliaskc/kajji)*
```

The `<!-- kajji:stack -->` HTML comment is a machine-readable marker for finding and updating the comment idempotently.

### Update Triggers

Stack comments are updated whenever the stack's remote state changes:
- New bookmark/PR added to the stack
- PR merged (removed from comment, remaining PRs re-numbered)
- Submit stack operation

### Implementation

```bash
# Find existing stack comment on a PR
gh api repos/{owner}/{repo}/issues/{pr}/comments \
  --jq '.[] | select(.body | contains("<!-- kajji:stack -->"))'

# Create or update
gh api repos/{owner}/{repo}/issues/{pr}/comments \
  -f body="<!-- kajji:stack -->
### Stack
..."
```

---

## Conflict Handling

jj allows conflicts to persist in commits. When rebasing a stack during sync:
- If conflicts occur, jj records them but continues the rebase
- Show clear warning in the sync result:
  ```
  Conflicts in push-session:
    - src/auth.ts
    - src/utils.ts

  Rebase completed with conflicts. Resolve before pushing.
  ```
- Block force-push of conflicted commits until resolved (or provide override)

---

## Commands

| Key | Context | Action |
|-----|---------|--------|
| `o` | Log | Open PR — modal with base picker if ancestor bookmarks exist |
| `O` | Log | Quick open — stack on ancestor, fallback trunk |
| `p` | Global | Push tracked bookmarks (`jj git push`) |
| `P` | Global | Push menu — existing options + submit stack entries |
| `f` | Global | Fetch (`jj git fetch`) |
| `F` | Global | Fetch menu — existing options + sync stack entries |

---

## Implementation Phases

### Phase 0: Stacked PR Open (extends existing PR flow)
- [ ] Detect ancestor bookmarks when pressing `o`
- [ ] Show base picker modal (ancestor vs trunk)
- [ ] `O` quick-open with default stacking behavior
- [ ] `gh pr create --base <ancestor>` for stacked PRs
- [ ] Post stack navigation comment on PR creation

### Phase 1: Submit Stack
- [ ] Stack discovery — find all bookmarks in connected ancestry chain
- [ ] `P` menu entry: submit stack (push all bookmarks with explicit `-b`)
- [ ] Stack identification with `bottom::top` notation
- [ ] Update stack navigation comments on all PRs in stack
- [ ] Handle multiple stacks in the push menu

### Phase 2: Sync Stack
- [ ] `F` menu entry: sync stack
- [ ] Detect merged PRs via `gh pr list --state merged`
- [ ] Confirmation modal showing proposed changes
- [ ] Restack: `jj rebase -s <new-bottom> -d main@origin`
- [ ] Cleanup: abandon merged changes, delete stale bookmarks
- [ ] Force-push remaining stack
- [ ] Update stack navigation comments

### Phase 3: Polish
- [ ] Handle edge cases (orphaned PRs, conflicts, multi-merge)
- [ ] PR status indicators in log (see [Future: PR Status](#future-pr-status-in-log))
- [ ] Multi-select stack operations (when multi-select lands)
- [ ] Undo support for stack operations

---

## Future: PR Status in Log

Deferred — implement after core stacking works.

Show PR status alongside commits in the log panel. Two candidate approaches:

**Option A: Appended character/emoji** — Add a status indicator after the commit line, rendered by kajji (not jj's template). Preserves jj's native bookmark coloring.

```
○  kywxvzoq  push-auth-fix  Add auth validation   ⏳
                                                    ^ appended by kajji
```

| Character | Meaning |
|-----------|---------|
| ⏳ | PR open, waiting for review |
| ✅ | PR approved / ready to merge |
| ❌ | PR checks failing |

**Option B: Vertical bar** — A colored bar on the left or right edge of the log, spanning each entry's height. Colored by PR status. This pattern could also encode multi-select state (focus vs selected).

| Color | Meaning |
|-------|---------|
| Yellow | PR open, waiting review |
| Green | PR approved / ready |
| Red | Checks failing |
| Blue | Selected (multi-select) |

The vertical bar pattern avoids interfering with jj's native text coloring and focus highlight. It also generalizes to other status dimensions.

**Data source:** PR status would be cached locally (populated on sync/`F`), mapping bookmark names to PR states via `gh pr list --json`. Not fetched live to avoid latency and rate limits.

**Note:** Merged PRs typically have their bookmarks deleted (depending on GitHub branch deletion settings), so merged status may not need display — the bookmark simply disappears from the log after sync.

---

## Implementation Notes

### Push Behavior

`jj git push` (bare, no flags) only pushes bookmarks that are already **tracked** on the remote — i.e., bookmarks that have been pushed at least once before. This means:

- First push of a bookmark requires `-b <name>`, `--change <id>`, or `--all`
- Subsequent pushes of a tracked bookmark work with bare `jj git push`
- **Submit stack must use explicit `-b` flags** to handle a mix of tracked and untracked bookmarks

### Base Targeting Logic

```typescript
function getBase(commit: Commit, stack: Commit[]): string {
  const idx = stack.indexOf(commit)
  if (idx === 0) return 'main' // or default branch
  const parent = stack[idx - 1]
  return parent.bookmarks[0] || `push-${parent.changeId.slice(0, 8)}`
}
```

### Idempotent PR Creation

Check for existing PR before creating:
```bash
gh pr list --head <branch> --json number,state,url
```
If exists, update via `gh pr edit`. If not, create new.

---

## Dependencies

- `gh` CLI must be installed and authenticated (for GitHub)
- Repository must have a supported remote
- jj must be configured with git backend (colocated repo)

---

## Forge Abstraction

The forge-specific surface area is small — all stack logic (discovery, restack, bookmark management, push) is pure jj. Only the PR layer touches the forge. Start with GitHub, but keep forge-specific code isolated for future multi-forge support.

### Interface

```typescript
interface Forge {
  createPR(head: string, base: string, options?: { draft?: boolean }): Promise<PR>
  listPRs(filters: { head?: string, state?: string }): Promise<PR[]>
  findStackComment(prNumber: number): Promise<Comment | null>
  upsertStackComment(prNumber: number, body: string): Promise<void>
  openInBrowser(prNumber: number): Promise<void>
}
```

### Approach

Don't build the abstraction upfront. Keep forge-specific code in `src/commander/github.ts` (which already exists). When a second forge is needed, extract the interface then.

The current code is already mostly in the right shape — `ghPrCreateWeb`, `ghBrowseCommit`, and the `gh api` calls for comment management are all in one file.

### Prior art

jjpr and jj-ryu both support multiple forges. jjpr auto-detects the forge from the remote URL (`github.com`, `gitlab.com`, `codeberg.org`) and talks directly to forge APIs via HTTP. jj-ryu uses `gh`/`glab` CLI fallbacks. Both validate that the abstraction boundary is clean.

---

## Prior Art & Evaluation

Thorough evaluation of the jj stacking ecosystem (March 2026):

### jj-native tools

**[jj-ryu](https://github.com/dmmulroy/jj-ryu)** — Stacked PRs for jj (Rust)
- Graphite-inspired: `ryu track`, `ryu submit`, `ryu sync`
- **Each bookmark = one PR** (not each commit). User places bookmarks, ryu manages PRs.
- **Explicit opt-in**: bookmarks must be `ryu track`-ed before submission. Tracking state in `.jj/repo/ryu/tracking.toml`
- **Stack discovery**: revset `trunk()..@`, filtered to commits with bookmarks
- **Restacking is the user's job**: ryu delegates to `jj rebase`, does not rebase itself
- **Stack navigation comments**: posted on each PR with full stack + `👈` marker for current PR. Embeds base64 JSON in HTML comment for machine readability
- **Dependency-aware execution**: topological sort with Kahn's algorithm to handle PR base retargeting before pushes (handles swap scenarios)
- **No merge commit support**: excludes commits with >1 parent
- Designed as a library (`jj_ryu` crate) — could be embedded in TUI apps
- GitLab support

**[jj-spr](https://github.com/LucioFranco/jj-spr)** — jj-native stacked PRs (Rust)
- Commands: `jj spr diff` (create/update PR), `jj spr land` (merge), `jj spr list`, `jj spr close`
- **PR identity stored in commit message**: appends `Pull Request: https://...` trailer to commit description
- **Branch naming**: slugified commit title (e.g., `spr/yourname/add-auth-module`), not change ID
- **Two modes**:
  - Default (dependent): PR targets parent PR's branch, reviewer sees incremental diff
  - `--cherry-pick` (independent): PR cherry-picked onto main, each PR stands alone. Docs recommend this as default.
- **Append-only updates**: never force-pushes PR branches. Creates new commits on top of existing PR history. Preserves GitHub "Files changed since last review."
- **Manual post-land rebase**: 3-4 manual commands after landing. Tool acknowledges this as friction (`TODO` in source for automation).
- **Requires colocated repo** (`.git` must exist)
- Write access to repo required (can't use fork workflow)

**[jj-stack](https://github.com/keanemind/jj-stack)** — Stacked PRs for jj (TypeScript)
- Philosophy matches ours: *"Jujutsu's CLI is already very ergonomic for managing stacks locally, so jj-stack specifically focuses on taking your local repo state and turning it into GitHub pull requests."*
- **Not an abstraction over jj** — does not help manipulate local repo
- Commands: `jst` (show stacks), `jst submit <bookmark>` (submit stack up to bookmark)
- **Bookmark-centric**: walks bookmarks toward `trunk()` to discover stacks
- Lightweight (Node.js)

**[jj-domino](https://github.com/zombiezen/jj-domino)** — Stack manager for jj (Go, March 2026)
- Minimal: `jj-domino -c 'trunk()..@-'` creates PRs for all changes in revset
- Uses `push-<change-id>` bookmark naming (similar to jj's `jj git push --change`)
- Infers everything from jj config (no separate config)
- Drafts for non-bottom PRs by default

**[jjpr](https://github.com/michaeldhopkins/jjpr)** — Multi-forge stacked PRs (Rust, actively maintained)
- **Multi-forge**: GitHub, GitLab, Forgejo/Codeberg in one binary
- **Stack merging with live re-evaluation**: `jjpr merge` merges bottom-up, rebases remaining after each merge
- **Pure HTTP**: talks directly to forge APIs, no `gh`/`glab` CLI required
- **Idempotent `submit`**: converges to correct state, pushes only what changed
- **Merge commit support**: `jj new A B` handled (follows first parent)
- **Foreign base detection**: auto-targets PRs at coworker's branch if stack builds on one
- Most feature-complete of the jj-native tools

### git-native tools (UX reference)

**[spr](https://github.com/ejoffe/spr)** — git-based stacked PRs (Go)
- **Each commit = one PR** (git-ism, not applicable to jj's bookmark model)
- **Status bits**: `[⌛❌✅❌]` — CI checks / approval / conflicts / stack status. Dense, information-rich.
- **commit-id injection**: appends stable 8-char ID to commit messages for tracking across rebases. Pollutes history.
- **Merge trick**: merges topmost ready PR into main (collapsing stack), closes PRs below. Confusing for reviewers.
- **WIP prefix**: commits starting with "WIP" skip PR creation
- **`--count N`**: operate on only bottom N PRs
- **No branch management**: user works on one branch, spr manages `spr/main/<id>` branches invisibly
- Valuable for UX patterns, not for architecture

**[Graphite](https://graphite.dev/)** — Commercial stacking tool
- **Stack model**: explicit parent-child tracking in `.git/.graphite_repo_config`
- **Auto-restack**: `gt modify` (amend) automatically cascades rebase to all upstack branches. The killer UX feature.
- **`gt sync`**: the "come back to work" command — pull trunk, delete merged branches (with confirmation), restack everything
- **`gt absorb`**: distributes staged hunks to the right commits automatically (magic mid-stack editing)
- **Conflict resolution UX**: inline stack context during conflicts — you always know where you are
- **Navigation**: `gt up/down/top/bottom` — spatial metaphor with filled/empty circle symbols (`◉`/`◯`)
- **Stack comments on PRs**: exactly the pattern kajji should adopt (comment with stack chain, updated continuously)
- **Idempotent submit**: `gt submit` safe to run repeatedly

### Key Decisions from Research

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stack model | Each bookmark = one PR | jj-native, matches all jj tools. spr's "each commit" is a git-ism |
| Stack concept | Implicit (jj log is the stack) | No separate tracking. jj-stack/jj-domino validate this approach |
| Remote sync | Force-push (default) | Simpler, matches jj's rewrite model. Append-only as future option |
| Stack type | Dependent (default) | PR targets ancestor bookmark. Independent as future option |
| Restacking | `jj rebase -s` | One command cascades to all descendants. jj handles conflicts gracefully |
| PR navigation | Stack comment (not body) | Idempotently updatable, matches Graphite's pattern |
| Status display | Deferred | Needs multi-select colors first. Vertical bar pattern preferred |

### Patterns to Adopt

| Pattern | Source | How |
|---------|--------|-----|
| Stack navigation comments | jj-ryu, Graphite | Comment with `<!-- kajji:stack -->` marker, updated on submit |
| Idempotent submit | jjpr, Graphite | Check existing PR before creating; submit safe to repeat |
| `bottom::top` stack notation | — | For identifying stacks in menus |
| Sync as power command | Graphite | fetch + detect merged + restack in one flow |
| Inline conflict context | Graphite | Show stack position during rebase conflicts (future) |

---

## Open Questions

- **Stack discovery revset**: exact revset for finding all bookmarks in a connected stack. Needs to handle multiple independent stacks, both ancestors and descendants of `@`. To be determined during implementation.
- **Force-push failures**: how to handle protected branches, required status checks, etc.?
- **Independent mode**: offer `--cherry-pick` style independent PRs as an option? When and how? Defer to Phase 3+.
- **Append-only sync**: add as option for teams that value GitHub "since last review"? Significant implementation complexity. Defer.
- **Integration with jj's eventual native GitHub support**: jj may add built-in PR management. Monitor [jj-vcs/jj#485](https://github.com/jj-vcs/jj/issues/485).
- **Use jj-ryu or jjpr as backend?**: Both are well-structured Rust crates. jj-ryu is designed as a library. Could potentially shell out to `jjpr` or `ryu` instead of implementing stack logic from scratch. Evaluate effort trade-off when starting implementation.

---

## Future: Full PR Management

Beyond stacking, kajji could become a full PR management tool.

See PR Management (archived in vault: `~/oh-yeah/Projects/kajji/archive/pr-management.md`) for archived exploration.

Summary of what's explored there:
- PR list with filtering (open, assigned, created by me, review requested)
- PR detail view (description, reviews, CI, files, diff)
- Actions: approve, request changes, comment (inline and general), merge
- GitHub file sync (track viewed files, sync with GitHub's checkboxes)
- AI-assisted review (see [AI Integration](./ai-integration.md))

### Why This Matters
This would make kajji a true "Graphite in TUI":
- Open-source and free
- Works with standard tools (jj + gh CLI)
- No vendor lock-in, no account required
- Full stacking workflow from creation to merge
