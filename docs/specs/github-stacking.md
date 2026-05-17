# GitHub PR Stacking

## Status

Canonical spec for kajji's stacked PR UX and stack operations.

This supersedes earlier exploration. The current direction is based on the bookmarks panel as the primary stack surface, with stack operations exposed from that context and mirrored later in the CLI for agents.

## Goal

Make kajji's bookmarks panel the primary place to understand and operate on GitHub PR stacks.

The UX is based on a **PR-target tree**:

- jj's DAG and trunk are the inputs.
- Each bookmark is a potential PR boundary.
- If a bookmark has a non-trunk ancestor bookmark, that ancestor is its PR target.
- If it has no ancestor bookmark, trunk is its PR target.
- Only actual multi-bookmark stacks are visualized as stacks; standalone bookmarks remain flat.

This keeps the hierarchy meaningful while still making trunk/main visible as the target for real stacks.

## Principles

- **Each bookmark = one PR.** A bookmark can span multiple commits. Users place bookmarks at PR boundaries using jj.
- **Bookmarks panel is the stack UX.** The jj log remains the commit graph; stack presentation and actions live in bookmarks.
- **Dependent stacks by default.** A child PR targets the nearest ancestor bookmark; a stack root targets trunk.
- **Standalone bookmarks stay standalone.** A bookmark that would target trunk is not shown as a stack unless it has stack children.
- **Submit is local → GitHub.** Submit makes GitHub PR state match the local jj/bookmark stack.
- **Sync is GitHub/trunk → local.** Sync reconciles local jj/bookmark state after remote or PR state changes.
- **Fetch does not auto-sync.** If fetch reveals that local stacks may be stale, kajji should surface that sync is available, but sync remains an explicit user action.
- **Dry-run first in UI.** Lowercase modal actions compute a plan and ask for confirmation; uppercase variants execute directly.
- **CLI mirrors UI later.** Stack operations should eventually be available to agents via `kajji stack ...` commands, but the TUI flow is the priority.

## Definitions

- **Trunk**: the repo's trunk bookmark, typically `main`.
- **Stack**: a chain of at least two non-trunk bookmarks connected by target relationships.
- **Stack root**: the bottom non-trunk bookmark in a stack; its target is trunk.
- **Stack tip**: the topmost bookmark in a stack.
- **Standalone bookmark**: a non-trunk bookmark that has no stack children and is not a child in a stack.
- **PR target tree**: the bookmark tree derived from nearest ancestor bookmark if present, otherwise trunk.

## Bookmarks Panel Visualization

The bookmarks panel should render bookmark rows as:

```text
bookmark-name  #123  rev-id  description
```

Rules:

- Bookmark name is the primary column.
- PR number is shown after bookmark name when known.
- Omit PR number entirely when unknown; do not render a placeholder.
- Revision/change id follows the optional PR number.
- Description follows revision id.
- Stack indentation uses the same row rendering as normal bookmarks, only prefixed with a muted stack marker.

Example:

```text
main                                  #150  xsnpmwxy  feat(APN-572): add audio tracking visuals
↳ APN-607/deployment-ard-platform     #151  rztqmtry  chore(backend): add deployment platform
  ↳ audio-tracking-visuals            #152  szvuqomv  code cleanup for PR
    ↳ poc/demo-results-detail...            xyluqyrl  DEMO: transition
APN-546-class-2-analysis-view         #149  qmmykump  APN-546 Class 2 analysis
```

### Important visualization rule

Do **not** nest every bookmark under trunk.

A standalone bookmark targeting trunk remains flat:

```text
main                                  xsnpmwxy  trunk description
APN-546-class-2-analysis-view         qmmykump  standalone branch
```

A stack is nested under trunk only when there is a real multi-bookmark stack:

```text
main                                  xsnpmwxy  trunk description
↳ APN-607/deployment-ard-platform     rztqmtry  stack root
  ↳ audio-tracking-visuals            szvuqomv  stack child
APN-546-class-2-analysis-view         qmmykump  standalone branch
```

This preserves the meaning of indentation: it indicates stack context, not merely "branched from trunk".

## Stack Highlighting

When the bookmarks panel is focused and the selected row belongs to an actual stack, visually emphasize that stack.

Desired behavior:

- Rows in the active stack remain fully opaque.
- Non-active-stack rows are dimmed using row-level opacity.
- Prefer OpenTUI row `opacity` over custom color/background changes.
- Include the trunk/target row in the active stack highlight.
- Selecting trunk itself does not activate highlighting.
- Selecting a standalone bookmark does not activate highlighting.
- Selecting any stack member activates the whole stack, not just that bookmark.

Example active stack:

```text
main                                  xsnpmwxy  trunk
↳ APN-607/deployment-ard-platform     rztqmtry  stack root
  ↳ audio-tracking-visuals            szvuqomv  stack child
    ↳ poc/demo-results-detail...      xyluqyrl  stack tip
APN-546-class-2-analysis-view         qmmykump  dimmed standalone row
```

## Stack Actions Entry Point

Stack actions are initiated from the bookmarks panel.

- Press `s` on a stack member to open the Stack Actions modal for that stack.
- Press `s` on trunk/main to open a stack picker listing available stacks under that trunk.
- Press `s` on a standalone bookmark to show a transient status-bar message, similar to the current "Compare to origin" unavailable behavior.
- Do not add a global stack keybind initially.
- Do not add a transient status-bar mode. Modal actions are instant and discoverable enough.

Rationale:

- The bookmarks panel has the clearest selection target for stack actions.
- Global stack actions would need extra disambiguation.
- Log-view selection may be inside a stack but not at a bookmark/PR boundary.

## Stack Picker for Trunk Selection

When trunk is selected and the user presses `s`, show a picker of stacks under that trunk.

Example:

```text
Stacks under main

main                                  xsnpmwxy  feat(APN-572): add audio tracking visuals
↳ APN-607/deployment-ard-platform     rztqmtry  chore(backend): add deployment platform
  ↳ audio-tracking-visuals            szvuqomv  code cleanup for PR
    ↳ poc/demo-results-detail...      xyluqyrl  DEMO: transition

main                                  xsnpmwxy  feat(APN-572): add audio tracking visuals
↳ other-stack-root                    abcdefgh  other stack root
  ↳ other-stack-child                 ijklmnop  other stack child

Enter choose   Esc cancel
```

Selecting a stack opens the Stack Actions modal for that stack.

## Stack Actions Modal

The Stack Actions modal should show the stack using the same rendering style as the bookmarks panel.

Example:

```text
Stack actions

main                                  #150  xsnpmwxy  feat(APN-572): add audio tracking visuals
↳ APN-607/deployment-ard-platform     #151  rztqmtry  chore(backend): add deployment platform
  ↳ audio-tracking-visuals            #152  szvuqomv  code cleanup for PR
    ↳ poc/demo-results-detail...            xyluqyrl  DEMO: transition

s  stack submit --dry-run
S  stack submit
f  stack sync --dry-run
F  stack sync

Esc cancel
```

Notes:

- Initial actions operate on the whole stack.
- Do not show which child bookmark opened the modal unless an action specifically targets that bookmark.
- Reuse bookmark row rendering where possible.
- Include descriptions.
- Include PR numbers when known.

## Standalone Bookmark Behavior

If the selected bookmark is not part of an actual stack, pressing `s` should not open a generic bookmark action modal.

Show an unavailable status-bar message instead:

```text
No stack for APN-546-class-2-analysis-view.
```

Rationale:

- `s` means stack actions.
- Standalone PR/bookmark operations already live elsewhere (`o`, push menu, etc.).
- A "create stack from here" action is not meaningful; a stack is created by adding descendant bookmarks.

## Actions

Initial stack actions:

```text
s  stack submit --dry-run
S  stack submit
f  stack sync --dry-run
F  stack sync
```

This mapping may be revisited after the flow settles. One possible future simplification is `s` for sync preview, `S` for submit preview, and a separate apply key from the preview/action modal. For now, keep the explicit four-action modal.

Do not include initially:

- push stack
- update comments/snippets
- merge
- doctor/status
- undo

These may be added later if needed. Undo needs its own design because stack operations mutate both jj/local state and GitHub state.

### Why no push action initially?

`push` and `submit` are easy to confuse:

- Push bookmarks: update remote bookmark refs.
- Submit stack: make GitHub PR state match the local jj/bookmark stack.

Since kajji already has push flows, the stack modal should avoid this ambiguity initially.

### Why no comments/snippets action?

Stack snippets are part of submit. Users should not need to run a separate "update comments" action.

## Submit

`stack submit` is the local-to-GitHub operation.

Definition:

> Ensure remote bookmarks and GitHub PRs match the local jj PR-target tree.

Responsibilities may include:

- push needed bookmarks explicitly
- create missing PRs
- update existing PR bases
- update stack snippets/comments/bodies
- report conflicts or GitHub state mismatches

`stack submit --dry-run` computes and displays the planned changes without applying them.

### UI behavior

Lowercase `s`:

1. Compute the submit plan.
2. Show a confirmation/plan modal.
3. Apply only if the user confirms with `enter`.
4. `esc` returns to the Stack Actions modal for the same stack.
5. Do not write the dry-run preview to the command log by default.

The plan modal should reuse the same stack row rendering as the bookmarks panel and Stack Actions modal. It should annotate rows with concise evaluated actions rather than showing a detached implementation checklist.

Example:

```text
Submit preview for APN-607/deployment-ard-platform

main                                  #150
↳ APN-607/deployment-ard-platform     #151  would retarget PR onto main
  ↳ audio-tracking-visuals            #152  would create PR onto APN-607/deployment-ard-platform

Would update PRs: #151
Would create PRs: audio-tracking-visuals

enter apply   esc back
```

Uppercase `S`:

1. Execute immediately.
2. Skip the pre-apply confirmation modal.
3. Stream/log execution output to the command log.

Even direct execution should still surface errors and final result in the command log.

## Sync

`stack sync` is the GitHub/trunk-to-local operation.

Definition:

> Fetch remote state, detect landed/closed stack PRs, and reconcile the local jj/bookmark stack.

Likely responsibilities:

- fetch remote state
- detect merged/closed PRs for bookmarks in the stack
- plan local rebase/cleanup work when parent PRs have landed
- retarget remaining PR bases if required
- report conflicts or GitHub state mismatches

### Fetch and stale stacks

`jj git fetch` can change trunk/remotes in ways that make local stack state stale, especially after a PR in a stack has merged. Fetch itself should not automatically run stack sync, because sync mutates local history with rebases.

Instead, kajji should detect when fetched state may affect local stacks and surface a lightweight prompt/indicator that sync is available. The exact UX is not decided yet. Possible directions:

- transient status-bar prompt, e.g. `Stack sync available`
- command-log info with a direct sync action
- stack-modal annotation on affected stacks

If affected stacks can be detected reliably, prefer syncing only those stacks. Otherwise, offer an explicit sync-all-local-stacks flow with a dry-run preview first.

`stack sync --dry-run` computes and displays the planned changes without applying them.

### Restack mechanics

When a parent PR lands, the likely local repair primitive is:

```bash
jj rebase -s <next-stack-bookmark> -d <updated-target>
```

`jj rebase -s` rebases the source commit and descendants together, preserving stack order. jj records conflicts in commits rather than leaving Git-style in-progress cherry-picks.

Exact cleanup details should be validated during implementation rather than treated as final in this UX spec.

### Stack snippets and sync

Sync does not update stack snippets by default.

Rationale:

- The snippet links to GitHub PRs by number.
- GitHub's native links show whether PRs are open/merged/closed.
- PR base/state is already visible in GitHub.
- Snippets only need updating when submit adds or reshapes the PR stack.

This policy can be revisited later if we add explicit pruning/refresh behavior.

### UI behavior

Lowercase `f`:

1. Compute the sync plan.
2. Show a confirmation/plan modal.
3. Apply only if the user confirms with `enter`.
4. `esc` returns to the Stack Actions modal for the same stack.
5. Do not write the dry-run preview to the command log by default.

The sync preview should use the same stack-connected modal style as submit, with concise per-row annotations.

Example:

```text
Sync preview for APN-607/deployment-ard-platform

main                                  #150
↳ APN-607/deployment-ard-platform     #151  targets main
  ↳ audio-tracking-visuals            #152  would rebase onto APN-607/deployment-ard-platform

Would rebase: audio-tracking-visuals

enter apply   esc back
```

Uppercase `F`:

1. Execute immediately.
2. Skip the pre-apply confirmation modal.
3. Stream/log execution output to the command log.

## Undo

`jj undo` is necessary but not sufficient for stack operations.

Stack actions can mutate GitHub state as well as jj state:

- create PRs
- retarget PR bases
- update stack snippets
- push bookmark refs
- delete/abandon local bookmarks or changes during sync

Kajji should eventually keep a stack operation journal for applied stack mutations. The journal should make it possible to explain and, where practical, reverse the last stack operation.

`kitlangton/stack` has this shape: it records an undo journal, then `stack undo --apply` can restore local branch backups, force-push restored branches, close PRs created by the previous operation, retarget PRs to their previous bases, and restore stack metadata.

For kajji, the exact mechanism should be designed during implementation, but the principle is the same:

- jj-local changes can lean on `jj op log` / `jj undo` where appropriate.
- GitHub mutations need explicit before/after state recorded by kajji.
- Applied `stack submit` / `stack sync` should record enough information to report what changed and what can be undone.
- Dry-run/plan previews do not need undo entries because they do not mutate state.

Potential journal entries:

- PR created: PR number, head bookmark
- PR base changed: PR number, previous base, new base
- Stack snippet changed: PR number, previous body/comment id/body, new body
- Bookmark pushed: bookmark name, previous remote target if known, new target
- Local cleanup/rebase: jj operation id before/after, affected bookmarks

Undo does not need to be an initial stack modal action, but the implementation should avoid painting us into a corner. Actual stack executions should have an operation boundary and enough metadata to support future undo.

## Dry Run and Command Log

In the UI:

- Lowercase dry-run actions show a plan modal.
- Dry-run previews are not written to the command log by default.
- Actual executions are written to the command log.
- Execution output should be streamed if possible.
- Execution issues should be visible in the command log.
- Do not use transient status-bar success/failure messages for completed stack submit/sync operations; the command log is the feedback surface for performed actions.
- Reserve transient status-bar messages for unavailable/no-op/lightweight feedback, such as `No stack for ...` or `Nothing to sync.`

For CLI:

- `--dry-run` prints the plan to stdout/stderr like a normal CLI command.
- Non-dry-run commands execute and print/log their result normally.

## Stack Snippet Format

Use a managed PR comment, not the PR body. The comment should be compact and GitHub-native.

Example on PR `#102`:

```markdown
<!-- kajji-stack pr=102 -->

### Stack

1. #101
2. #102 👈
3. #103

This stack is managed by [kajji](https://github.com/eliaskc/kajji).
```

Notes:

- GitHub automatically links PR numbers.
- The current PR is marked with `👈` after its PR number.
- Do not include bookmark names in the stack comment.
- The snippet does not need to show PR base, state, checks, or review status.
- Those are native GitHub concepts visible on the PRs themselves.
- The marker identifies the PR whose comment is being managed so kajji can find/update the right comment safely.

## PR Numbers in Kajji

The bookmarks panel should show PR numbers when known.

Example:

```text
APN-607/deployment-ard-platform  #151  rztqmtry  chore(backend): add deployment platform
APN-546-class-2-analysis-view          qmmykump  APN-546 Class 2 analysis
```

Rules:

- Show PR number for stack and standalone bookmarks.
- Omit PR number when unknown.
- Do not show a placeholder.
- Consider adding PR numbers to the log panel later, but bookmarks panel comes first.

## CLI Mirror

Kajji should eventually expose stack operations in the CLI so agents can perform them. This is lower priority than completing the TUI stack flow.

Initial command shape:

```bash
kajji stack list
kajji stack submit [bookmark] --dry-run
kajji stack submit [bookmark]
kajji stack sync [bookmark] --dry-run
kajji stack sync [bookmark]
```

No separate generic PR CLI is needed initially; users and agents can use `gh` for generic PR operations. Kajji's stack CLI should focus on jj/bookmark stack orchestration.

## Implementation Architecture: Effect

Stack operations should be built on Effect rather than as ad-hoc commander/TUI logic.

Rationale:

- Stack operations combine jj/local mutations, GitHub mutations, dry-run planning, command streaming, and future undo journaling.
- Failures need to be typed and surfaced with actionable recovery guidance.
- Submit/sync should be testable with mocked jj and GitHub services, especially for partial failure and conflict scenarios.
- UI and CLI should share the same stack planner/interpreter rather than duplicating orchestration logic.

The first production implementation should focus Effect usage on the stack core and adjacent command boundaries, not on rewriting the TUI.

Recommended service boundaries:

- `Jj`: stack-relevant jj queries and mutations, including graph/bookmark state, `jj rebase -s`, operation ids, and undo-related queries.
- `GitHub`: PR lookup/creation/update, base retargeting, body/comment snippet updates, and PR state reads.
- `StackJournal`: durable operation journal for applied mutations and future undo support.
- `StackPlanner`: pure or mostly pure discovery/planning for submit/sync dry-runs.
- `StackExecutor`: apply-mode interpreter that executes a plan, streams/logs progress, and records journal entries.

Initial Effect scope:

- Build stack discovery, submit planning, sync planning, and apply-mode execution in an Effect subsystem.
- Keep the Solid/OpenTUI UI mostly outside Effect; call into the stack runtime at modal/action boundaries.
- Keep existing non-stack commander code unless it becomes a natural dependency of stack services.

Potential next steps after stack lands:

- Migrate commander process execution into an Effect-backed process service.
- Migrate jj command wrappers used by stack into Effect services first, then consider broader commander migration.
- Migrate GitHub PR helpers used by stack into typed Effect services.
- Reuse the same services for the future `kajji stack ...` CLI mirror.

## Durable Stack Journal

Stack operation journals should be stored in kajji-owned global cache state, not in the repository worktree. Prefer `~/.cache/kajji/...` on Unix-like systems, with platform-appropriate fallbacks later if needed.

The journal path should include a stable repo key, for example a hash of the repository root path, to avoid collisions:

```text
~/.cache/kajji/stack-journal/<repo-key>/<journal-id>.json
```

Rationale:

- Do not create project worktree files for kajji internals.
- Keep operation/undo metadata app-owned.
- Avoid requiring users to add project-specific ignores.
- Make future cleanup/inspection of kajji state straightforward.

`kitlangton/stack` stores state under Git metadata (`.git/stack/...`), which similarly avoids touching the worktree. For kajji, a global cache is preferred.

## Polish / Follow-up

Before shipping, refine edge cases and presentation:

- no-op plan messaging when submit/sync has nothing to do
- stale or missing PR metadata handling
- clearer conflict/error guidance for failed apply operations
- stable modal layout when moving between actions and previews
- consistent stack row rendering across bookmarks, actions, picker, and previews
- exact wording for row annotations such as `targets main`, `would retarget PR onto ...`, and `would rebase onto ...`

Avoid a broad UI rewrite as part of adopting Effect. The valuable migration boundary is command orchestration, error handling, streaming, and testability.

## Implementation Notes from the PoC

The current PoC already implemented several UX pieces that should be preserved or reimplemented cleanly:

- Bookmark rows render as `bookmark-name rev-id description` instead of `rev-id bookmark-name description`.
- Stack visualization lives in the bookmarks panel, not the jj log.
- Stack indentation uses a muted `↳` marker.
- Stack structure is based on actual jj parent relationships, not recency/log order guesses.
- Parent commit ids were added to log parsing so stack inference can walk the DAG.
- Trunk/simple branches are not shown as stacks unless they anchor an actual multi-bookmark stack.
- Stack highlighting uses row-level opacity dimming when the bookmarks panel is focused.
- Selecting trunk or standalone bookmarks does not activate stack highlighting.
- Selecting any stack member activates highlighting for the whole stack, including the trunk target.

When moving from PoC to production implementation, consider extracting stack discovery into a shared service/planner that can be used by:

- bookmarks panel
- stack action modal
- CLI commands
- future command palette entries

## Prior Art

Useful references:

- `kitlangton/stack`: concise `sync` workflow, GitHub-native stack block, agent-friendly CLI shape.
- Graphite: stack navigation snippets and submit/sync mental model.
- jj-native tools such as jj-ryu, jjpr, jj-stack, and jj-domino: validate bookmark-centric stacks for jj.

This spec intentionally keeps only the decisions relevant to kajji's current direction rather than carrying forward all earlier research details.
