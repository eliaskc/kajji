# CLI Commands

> Agent-friendly CLI for operations that jj doesn't expose non-interactively.

## Philosophy

**Extend, don't replace.** jj has excellent CLI commands. kajji CLI only adds:
1. Structured output with addressable IDs (for agents)
2. Non-interactive versions of interactive operations (split)
3. Higher-level workflows (stacked PRs)

Users should still use `jj diff`, `jj rebase`, `jj log` directly. kajji CLI is for what jj can't do non-interactively.

**Two interfaces, one codebase:**
- `kajji` (no args) → TUI
- `kajji <command>` → CLI

Shared logic: same jj output parsers, same commander modules, same stack management code.

---

## Design Principles

> What's good for humans is good for agents, and vice versa.

### Clear, Consistent Output

Every command should have output that:
- **Humans can scan** — Readable default format, good use of whitespace
- **Agents can parse** — `--json` flag for structured output
- **Errors explain themselves** — What went wrong, why, and how to fix it

```bash
# Good error
$ kajji split abc123 --first h99
Error: Hunk 'h99' not found in revision abc123.
Available hunks: h1, h2, h3
Run 'kajji changes abc123' to see all hunks.

# Bad error
$ kajji split abc123 --first h99
Error: Invalid hunk ID
```

### Predictable Behavior

- Same input → same output (deterministic)
- No hidden state or magic
- Explicit over implicit
- Dry-run available for destructive operations

### Excellent Help

Every command should have:
- `--help` with clear description and examples
- Error messages that guide toward the solution
- Man pages (future)

```bash
$ kajji split --help
Split a commit into multiple commits non-interactively.

Usage: kajji split <rev> [options]

Arguments:
  <rev>  The revision to split (change ID or commit ID)

Options:
  --first <hunks>         Comma-separated hunk IDs for first commit
  --first-message <msg>   Subject line for first commit
  --first-body <body>     Body for first commit (optional)
  --rest-message <msg>    Subject line for remaining commit
  --rest-body <body>      Body for remaining commit (optional)
  --dry-run               Show what would happen without executing
  --json                  Output result as JSON
  --help                  Show this help

Examples:
  # Split hunks h1 and h3 into first commit
  kajji split abc123 --first h1,h3 --first-message "Add validation"

  # See available hunks first
  kajji changes abc123

  # Preview without executing
  kajji split abc123 --first h1 --first-message "WIP" --dry-run
```

### Composable

Commands should work well in pipelines:
```bash
# Get hunk IDs, filter, pass to split
kajji changes abc123 --json | jq '.files[0].hunks[0].id' | xargs ...

# Script stack creation
kajji stack create $(jj log -r 'trunk()..@' --no-graph -T 'change_id ++ " "')
```

---

## Core Principle: Addressable Hunks

The key insight: agents need **deterministic IDs** to reference specific changes.

```bash
$ kajji changes abc123
```
```json
{
  "revision": "abc123",
  "files": [
    {
      "path": "src/auth.ts",
      "status": "modified",
      "hunks": [
        { "id": "h1", "lines": "10-25", "added": 15, "removed": 3 },
        { "id": "h2", "lines": "40-42", "added": 2, "removed": 0 }
      ]
    },
    {
      "path": "src/utils.ts", 
      "status": "modified",
      "hunks": [
        { "id": "h3", "lines": "5-8", "added": 3, "removed": 1 }
      ]
    }
  ]
}
```

These IDs (`h1`, `h2`, `h3`) are stable for a given revision and can be passed to other commands.

---

## Commands

### `kajji changes [rev]`

List changes with addressable hunk IDs.

```bash
# Human-readable (default)
$ kajji changes abc123
src/auth.ts (M)
  h1  lines 10-25   +15 -3
  h2  lines 40-42   +2 -0
src/utils.ts (M)
  h3  lines 5-8     +3 -1

# JSON for agents
$ kajji changes abc123 --json
{ "revision": "abc123", "files": [...] }

# Include diff content
$ kajji changes abc123 --diff
```

**Options:**
- `--json` — Machine-readable output
- `--diff` — Include actual diff content per hunk
- `--lines` — Show line-level IDs (for fine-grained splitting)

### `kajji split <rev>`

Non-interactive split with hunk selection.

```bash
# Split specific hunks to first commit
$ kajji split abc123 \
  --first h1,h3 \
  --first-message "Add validation logic" \
  --rest-message "Imports and helpers"

# Split with full commit body
$ kajji split abc123 \
  --first h1 \
  --first-message "Add auth validation" \
  --first-body "Implements RFC-123 validation rules.

This adds input validation for..." \
  --rest-message "Supporting changes"

# Interactive mode (falls back to jj split)
$ kajji split abc123 --interactive
```

**Options:**
- `--first <hunk-ids>` — Comma-separated hunk IDs for first commit
- `--first-message <subject>` — First commit subject
- `--first-body <body>` — First commit body (optional)
- `--rest-message <subject>` — Remaining commit subject
- `--rest-body <body>` — Remaining commit body (optional)
- `--interactive` — Fall back to `jj split` TUI
- `--dry-run` — Show what would happen without executing

**Line-level splitting (future):**
```bash
# Split specific lines within a hunk
$ kajji split abc123 --first h1:10-15,h1:20-25 --rest h1:16-19
```

### `kajji stack create <revs...>`

Create a PR stack from commits.

```bash
# Create stack from commit range
$ kajji stack create abc123 def456 ghi789

# With custom base
$ kajji stack create abc123 def456 --base develop

# Override bookmark names
$ kajji stack create abc123 def456 \
  --names "feature-auth,feature-auth-tests"

# All as drafts (override default base-ready behavior)
$ kajji stack create abc123 def456 --all-draft
```

**Output:**
```json
{
  "stack": "feature-auth",
  "prs": [
    { "number": 42, "bookmark": "push-abc123", "base": "main", "draft": false },
    { "number": 43, "bookmark": "push-def456", "base": "push-abc123", "draft": true }
  ]
}
```

**Options:**
- `--base <branch>` — Base branch (default: main/master)
- `--names <bookmarks>` — Custom bookmark names (comma-separated)
- `--all-draft` — Create all PRs as drafts
- `--all-ready` — Create all PRs as ready
- `--json` — Machine-readable output
- `--dry-run` — Show what would be created

### `kajji stack list`

List all PR stacks.

```bash
$ kajji stack list
feature-auth (3 PRs)
  #42 push-abc123 → main      ✓ merged
  #43 push-def456 → push-abc123  ● ready
  #44 push-ghi789 → push-def456  ○ draft

cleanup-api (2 PRs)
  #50 push-xyz111 → main      ○ draft
  #51 push-xyz222 → push-xyz111  ○ draft

$ kajji stack list --json
```

### `kajji stack sync`

Reconcile stacks after merges.

```bash
$ kajji stack sync
Stack 'feature-auth' has changes:
  - #42 was merged to main
  - Rebasing #43 onto main (was: push-abc123)
  - Updating PR #43 base to main

Done. 1 stack updated.

# Non-interactive (for agents)
$ kajji stack sync --yes

# Specific stack only  
$ kajji stack sync feature-auth
```

**Options:**
- `--yes` — Apply changes without confirmation
- `--dry-run` — Show what would change
- `--json` — Machine-readable output

### `kajji stack show <name>`

Show details of a specific stack.

```bash
$ kajji stack show feature-auth
Stack: feature-auth
Base: main
PRs: 3

#42 push-abc123 (base)
  Status: merged
  Title: Add auth validation
  
#43 push-def456
  Status: ready, CI passing
  Title: Add error handling
  Base: push-abc123
  
#44 push-ghi789  
  Status: draft
  Title: Add tests
  Base: push-def456
```

---

## Global Options

All commands support:
- `--json` — Machine-readable JSON output
- `--help` — Show command help
- `--version` — Show kajji version

---

## Implementation Notes

### Hunk ID Generation

Hunk IDs must be:
- **Stable** — Same revision always produces same IDs
- **Deterministic** — Based on file path + hunk position
- **Simple** — Short, easy to type/copy

Algorithm:
```typescript
// h1, h2, h3... global counter across all files
// or: src/auth.ts:1, src/auth.ts:2, src/utils.ts:1
// Simpler is better for agent usage
```

### Diff Parsing

Reuse existing diff parsing from TUI:
- `src/commander/diff.ts` already parses jj diff output
- Extend to track hunk boundaries and generate IDs
- Add JSON serialization

### Stack Detection

A "stack" is detected by:
1. Bookmarks with associated PRs (via `gh pr list`)
2. PR base relationships forming a chain
3. All targeting the same ultimate base (main/master)

Store stack metadata locally? Or derive from GitHub state each time?
- **Derive each time** — simpler, always accurate, slightly slower
- **Cache** — faster, but can go stale

Start with derive, optimize later if needed.

---

## Evolution & Compatibility

### jj Native Support

jj may eventually add:
- Non-interactive split (`jj split --hunks`)
- Native GitHub PR support

When this happens:
- Deprecate kajji equivalents gracefully
- Point users to native commands
- Keep kajji CLI for higher-level workflows (stacks)

### GitHub Stacked PR Support

GitHub may improve stacked PR UX. When this happens:
- Adapt stack commands to use new APIs
- Maintain backward compatibility

### Versioning

CLI output format is a contract. Use semantic versioning:
- Breaking JSON schema changes = major version bump
- New fields = minor version bump
- Include schema version in JSON output:
  ```json
  { "version": "1", "data": { ... } }
  ```

---

## Future Ideas

**PR commands:**
- `kajji pr create <rev>` — Single PR creation (simpler than `stack create` for one commit)
- `kajji pr list` — List all PRs for this repo
- `kajji pr show <number>` — Show PR details
- `kajji pr merge <number>` — Merge PR

**Advanced splitting:**
- Line-level splitting (not just hunks)
- `kajji changes --watch` — Stream changes as they happen (for agent monitoring)

**Documentation & discoverability:**
- Man pages generated from help text
- `kajji help <topic>` — Explain concepts (stacks, hunks, etc.)
- Shell completions (bash, zsh, fish)
- `kajji doctor` — Check setup (jj installed, gh authenticated, etc.)

---

## Non-Goals

Things kajji CLI will NOT do (use jj directly):

**Core operations:**
- `jj diff` — already outputs diffs
- `jj log` — already has templates, revsets
- `jj rebase` — non-interactive, works great
- `jj describe` — non-interactive
- `jj new` — non-interactive
- `jj squash` — non-interactive

**File-level splitting:**
- `jj split [FILESETS]` — already works! `jj split src/auth.ts` splits that file out
- kajji only adds **hunk-level** splitting (which jj requires interactive editor for)

**Smart change distribution:**
- `jj absorb` — automatically moves changes to the right commit based on blame
- This is amazing and non-interactive. Don't wrap it, just tell users about it.

**Workspace management:**
- `jj workspace add/list/forget/rename` — already complete
- kajji TUI shows workspace status, but CLI shouldn't wrap these

**Push with dry-run:**
- `jj git push --change --dry-run` — already available

The rule: if jj does it well non-interactively, don't wrap it.

## Complementary jj Commands

Commands that work well alongside kajji CLI:

| jj command | Use for |
|------------|---------|
| `jj absorb` | Auto-distribute working copy changes to correct commits in stack |
| `jj split [FILES]` | File-level splitting (kajji adds hunk-level) |
| `jj git push --change` | Push single commit (kajji adds stack push + PR creation) |
| `jj workspace add` | Create workspace (kajji shows status, jj manages) |

Agents should know both kajji and jj commands — use the right tool for the job.

---

## Priority

Medium effort | High impact for agent workflows

Depends on:
- TUI split implementation (shared hunk parsing logic)
- Stack creation flow (shared stack logic)

Enables:
- Agent-driven development workflows
- CI/CD integration
- Scripting complex operations
