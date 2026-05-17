# Effect Migration Notes

Kajji is starting to use Effect for the GitHub stacking implementation. The intended migration style is incremental: use Effect for bounded subsystems where typed errors, dependency injection, structured concurrency, and test layers directly help, rather than rewriting the TUI wholesale.

## Current boundary

The first production stack slice uses Effect in `src/stack` for stack discovery/modeling, while the TUI and most commander helpers remain Promise-based.

That boundary is intentional for now:

- Solid/OpenTUI UI code can stay ordinary signal/event code.
- Commander wrappers can keep existing behavior until we migrate command execution deliberately.
- Stack code can become Effect-native behind a small async/Promise boundary.

## Why commander/process execution is the next natural migration

Process execution is one of the clearest places where Effect is better than ad-hoc Promises.

Today, helpers like GitHub metadata loading spawn `gh` and use `Promise.all` to concurrently:

- read stdout
- read stderr
- wait for process exit

This works, but it does not give us structured interruption, typed process errors, scoped cleanup, or reusable test layers. If one side fails, the other concurrent readers are not modeled as fibers that can be interrupted as a group.

An Effect process service would let us model command execution as one scoped operation:

```ts
const [stdout, stderr, exitCode] = yield* Effect.all(
  [readStdout, readStderr, waitForExit],
  { concurrency: "unbounded" },
)
```

with typed errors and cleanup around the spawned process.

This mirrors the direction in reference projects such as opencode's `AppProcess` service.

## Suggested migration order

### 1. AppProcess service

Add an Effect service for shell/process execution, e.g.:

```text
src/process/AppProcess.ts
```

Responsibilities:

- spawn commands
- collect stdout/stderr
- optionally stream output to observers
- enforce timeouts/cancellation
- return structured results
- fail with typed process errors

Potential error shape:

```ts
AppProcessError {
  command: string
  args: readonly string[]
  exitCode?: number
  stderr?: string
  cause?: unknown
}
```

### 2. GitHub service

Move `gh` command helpers behind an Effect service:

```text
src/stack/services/GitHub.ts
```

or, if useful outside stacking:

```text
src/commander/effect/GitHub.ts
```

Initial methods:

- lookup PRs by bookmark heads
- open/create PR in browser
- later: create/update/retarget PRs, update snippets, fetch PR state

The existing Promise-based helpers can wrap the Effect service temporarily so UI call sites do not all change at once.

### 3. Jj service

Move jj reads/mutations behind an Effect service:

- log/bookmark reads needed by stack discovery
- push bookmark
- rebase/restack
- op log / op id before and after operations
- undo integration
- conflict detection and recovery metadata

This service should be testable with fake layers for tricky stack states.

### 4. Stack submit/sync planners and interpreters

Once GitHub and Jj services exist, implement stack operations as Effect programs:

- dry-run planners are read-only and produce structured plans
- apply interpreters mutate jj/GitHub and stream/log output
- mutations record undo journal entries as they happen

### 5. Durable undo journal

Add a StackJournal service after the first mutating stack operations are designed.

The journal should record facts, not UI text:

- PR created
- PR base changed
- PR body/snippet changed
- bookmark pushed
- jj operation id before/after local mutations

`jj undo` is a tool the journal can use, not the whole undo system, because GitHub mutations need explicit before/after metadata.

## What not to migrate yet

Do not Effect-ify the Solid/OpenTUI rendering layer just to use Effect everywhere. The UI should remain mostly signal/event driven and call Effect programs at operation boundaries.

Good Effect boundaries:

- command execution
- GitHub API/CLI access
- jj access
- stack planning/apply
- undo journaling
- tests with fake services

Less useful boundaries for now:

- simple render helpers
- pure formatting functions
- local component state
- focus/keybind plumbing
