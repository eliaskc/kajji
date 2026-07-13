# Effect v4 Migration

## Status

**First production slice complete.** User-triggered `jj git fetch` now runs
through the Effect-native `Jj` and `AppProcess` capabilities. The resulting
interfaces have been exercised in production use and are ready to extend one
capability at a time; this document is not a complete design for every later
module.

Kajji currently pins `effect@4.0.0-beta.98`. Keep that version fixed during a
migration slice and verify APIs against the matching Effect source. Upgrade
Effect before beginning a later slice so lifecycle and dependency changes are
not introduced midway through implementation.

The first production slice is `jj git fetch`. Later work should proceed
capability by capability, with existing behavior preserved at each compatibility
seam.

## Why Effect

Kajji's main asynchronous problems are ownership problems:

- process execution is duplicated across jj, gh, hooks, updates, editors, and
  repository checks
- process failures, non-zero exits, warnings, and unexpected exceptions have
  inconsistent semantics
- timeout and cancellation cleanup are manual or absent
- command logging depends on a mutable module-level observer
- stack workflows wrap rejecting Promises in Effect while importing their
  dependencies directly
- tests replace imported modules instead of supplying deterministic
  implementations

Effect is useful at these resource-owning asynchronous seams because it provides
scopes, interruption, structured concurrency, typed failures, and dependency
substitution. It is not expected to improve rendering or ordinary local state.

## Goals

- One interruption-safe implementation for non-interactive subprocesses.
- Separate process lifecycle failures from normal command exits.
- Preserve stdout and stderr, including stderr from successful commands.
- Make jj, GitHub, and stack workflows testable with supplied implementations.
- Own one Effect runtime at each application entry point.
- Keep Effect environments and runtime execution out of Solid components.
- Replace implicit command observation with explicit operation data over time.
- Preserve behavior through temporary Promise-facing adapters.
- Improve stack mutation safety after the process and domain seams exist.

## Non-goals

- Rewriting the TUI or Solid contexts as Effect services.
- Wrapping pure parsers, planners, and formatting helpers in Effect.
- Migrating every process family in the first slice.
- Designing a universal event bus.
- Adding Node support or a second process implementation without a real need.
- Redesigning notices, error screens, or command-log UX as part of the first
  slice.
- Keeping compatibility adapters after their callers have migrated.

## Validated Decisions

An isolated spike used an Effect service with a `Bun.spawn` implementation, a
fake implementation, and one read-only jj operation. Its tests covered concurrent
stdout and stderr capture, normal non-zero exits, typed spawn failures, timeout
cleanup, and explicit fiber interruption.

The spike established these decisions:

1. Child processes are acquired with `Effect.acquireRelease` and consumed inside
   `Effect.scoped`. Normal completion, failure, timeout, and interruption share
   one cleanup path.
2. A normal non-zero exit is a `ProcessResult`, not a process lifecycle failure.
   Domain modules such as `Jj` interpret exit codes.
3. stdout, stderr, and process exit are awaited concurrently as one scoped
   operation.
4. The process interface is runtime-neutral. Bun-specific handles and stream
   types stay inside the live implementation.
5. A fake process implementation is the test seam for command construction and
   domain exit policy. Tests should not need `mock.module` for new code.
6. Pure parsing and planning remain ordinary deterministic functions.
7. Effects are run at owned application edges, not inside services or Solid
   components.

The spike intentionally did not settle streaming and backpressure details,
process groups, command events, application shutdown integration, or final file
layout. The first production slices should settle those through working code and
contract tests rather than a larger up-front abstraction.

## Dependency Direction

```text
Solid / OpenTUI
      |
Promise-facing application client
      |
Owned ManagedRuntime
      |
Application workflows
      |
Jj / GitHub / RepositoryHealth / StackJournal
      |
AppProcess / operation sink
```

Solid code calls a narrow application client and receives ordinary values or
Promises. It does not assemble layers, supply Effect environments, or call
`Effect.runPromise` directly.

Pure parsers and planners sit beside this graph. Domain modules call them without
turning them into services.

## Implementation Rules

### Effect v4

- Use `Context.Service` for services at the pinned Effect version.
- Use `Layer.succeed(Service)(implementation)` for already-constructed
  implementations and `Layer.effect(Service)(effect)` when construction is
  effectful.
- Use `Effect.fn` for exported service operations and substantial workflows, not
  tiny helpers.
- Use typed errors for expected lifecycle and domain failures. Preserve
  unexpected defects for the runtime diagnostics edge.
- Use Effect interruption as the internal cancellation model. `AbortSignal` is
  only an adapter at Promise-facing edges.
- Never create nested or per-operation runtimes.

### AppProcess

`AppProcess` is executable-neutral infrastructure. Its interface should be
small; its live implementation owns the difficult lifecycle behavior.

It owns:

- executable and argv-array spawning
- explicit cwd and environment overrides
- stdin mechanics required by migrated callers
- concurrent stdout and stderr draining with stream identity
- bounded capture when a caller selects a bound
- timeout and interruption cleanup
- child termination, reader cleanup, and process reaping
- typed spawn, read, write, and timeout failures

It does not own:

- jj, git, gh, or hook semantics
- command construction or parsing
- interpretation of non-zero exits
- default timeouts for domain operations
- shell interpretation, except through an explicit adapter for a real shell
  capability
- command-log visibility, repository refresh, or UI policy

Every command receives an explicit repository path or cwd captured when the
operation starts. Long-running operations must not repeatedly read mutable
global repository state.

`AppProcess.run` returns stdout, stderr, exit code, duration, and any selected
capture-limit evidence for every normal exit. It does not return a redundant
`success` boolean in Effect-native code.

### Jj

`Jj` owns jj-specific argument construction, environment policy, exit
interpretation, and parser invocation. It uses `AppProcess` and returns
jj-specific results or typed errors.

The first capability is git fetch, including the current options for branches,
tracked bookmarks, selected remotes, and all remotes. Existing parser modules
remain pure as later read capabilities move behind `Jj`.

### Runtime and application client

The TUI composition root owns one `ManagedRuntime`. The runtime remains private
behind a small application client. CLI entry points may construct shorter-lived
runtimes with only the layers they require.

Shutdown must be idempotent and shared by normal quit, SIGINT, and SIGTERM:

1. Stop accepting new application operations.
2. Interrupt active operation fibers.
3. Dispose the runtime and its scopes.
4. Destroy the OpenTUI renderer.
5. Set the exit code or exit the process.

Once the runtime exists, direct `process.exit()` paths must not bypass this
sequence.

### Compatibility and command output

New Effect implementations are the source of truth. Temporary adapters preserve
the current Promise result and rejection behavior for unchanged callers.

The first operation uses an explicit, infallible output/operation sink. Do not
introduce a queue, `PubSub`, or application-wide event bus until multiple real
consumers require fan-out.

The compatibility edge may translate process output and completion into the
existing `CommandObserver`. One user operation must produce exactly one visible
command-log entry. Output-sink failure must not fail the underlying command.

## First Production Slice: `jj git fetch`

The first slice proves the architecture end to end without stack mutation. Fetch
is representative because it is user-triggered, network-duration, observable,
fallible, and useful for testing cancellation and shutdown.

### Step 0: Baseline

Before changing the fetch path:

- add characterization tests that import the production executor rather than a
  duplicate test helper
- cover stdout and stderr capture, successful stderr, non-zero exit behavior,
  cwd and environment behavior, observer ordering, and exactly-once completion
- record the existing TUI benchmark baseline
- retain the existing terminal launch-and-quit and command-log workflow coverage

The baseline protects behavior; it is part of implementation, not a separate
architecture phase.

### Step 1: Process module

- define the minimal command, result, and lifecycle error types required by
  fetch
- implement a Bun-backed live `AppProcess`
- implement a small fake using `Layer.succeed`
- drain stdout and stderr concurrently
- acquire and release the child through a scope
- implement timeout and interruption cleanup
- preserve raw normal non-zero exits

Do not add interactive stdio, shell pipelines, update behavior, or a second
runtime implementation in this step.

### Step 2: Runtime edge

- compose the live layer and one TUI-owned `ManagedRuntime`
- expose a Promise-facing application client
- add idempotent runtime disposal to the shared quit path
- route SIGINT and SIGTERM through that path
- keep all runtime execution outside Solid components

The initial runtime, layer composition, and client may remain in one module until
their implementations are large enough to justify separate files.

### Step 3: Jj fetch

- add a narrow `Jj` capability for git fetch
- preserve every existing fetch option and display command
- capture the repository path at invocation
- interpret non-zero exits as a jj-specific command failure
- preserve stdout, stderr, and diagnostic evidence
- adapt output to the existing command log without using the global
  `activeObserver`
- refresh repository state only after a successful result, as today

Only the user-triggered fetch path moves in this slice. Stack fetch remains on
the legacy path until stack workflows migrate to supplied services.

### Step 4: Verify and review

The slice is complete when:

- user-triggered `jj git fetch` runs through `Jj` and `AppProcess`
- existing Promise-facing and command-log behavior is preserved
- successful stderr is retained
- normal non-zero exits and lifecycle failures remain distinguishable
- timeout, explicit cancellation, and application shutdown terminate and reap
  the child
- one fetch creates exactly one command-log entry
- no Solid component calls `Effect.runPromise`
- focused tests, `bun test`, `bun check`, and changed-file Biome checks pass
- TUI benchmark results show no material regression, with timing treated as
  evidence rather than a flaky hard threshold

Review the resulting interface before migrating another caller. Rename or
reshape it based on the production slice rather than preserving the spike's API.

## Implementation Update — 2026-07-13 21:14:56 CEST

The first production slice is complete:

- upgraded and pinned Effect to `4.0.0-beta.98`, with matching v4 source cloned
  under `/tmp` alongside OpenCode's `v2` branch for reference
- added the scoped Bun implementation and fake-layer seam in
  `src/process/app-process.ts`
- added typed jj fetch construction and exit policy in `src/commander/jj.ts`
- added the TUI-owned `ManagedRuntime`, Promise adapter, and explicit
  `CommandObserver` compatibility sink in `src/application/client.ts`
- routed only user-triggered fetch through the new client; stack fetch remains
  on the legacy executor as planned
- unified normal quit, SIGINT, and SIGTERM around idempotent runtime disposal
  before renderer destruction and process exit
- kept Effect runtime execution outside Solid; `App` receives the stable
  application client as `app`

The process contract now covers concurrent stdout and stderr capture, successful
stderr, raw non-zero exits, typed spawn/read/timeout failures, explicit cwd and
environment overrides, timeout cleanup, fiber interruption, process-group
termination, and child reaping. The compatibility edge preserves the existing
Promise result shape and creates exactly one command-log entry per fetch.

Production use also confirmed that the explicit operation-local sink fixes a
legacy concurrency bug for fetch: rapid overlapping operations could leave the
module-level `activeObserver` installed while refresh reads ran, causing internal
jj templates and output to contaminate the visible command log. Migrated fetches
no longer touch that mutable observer. Other legacy operations can still expose
the same class of bug until migrated.

Verification evidence:

- production executor characterization tests now import the real executor rather
  than a duplicate subprocess helper
- `bun test`: 313 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: 10 passing terminal workflows
- three-run TUI benchmark medians changed from 1688 ms to 1663 ms startup and
  from 831 ms to 797 ms fetch; peak Kajji RSS changed from 529.6 MiB to
  537.3 MiB, with no material regression

The reviewed layout is capability-oriented rather than technology-oriented:
`src/process`, `src/commander`, and `src/application`. No general `src/effect`
folder or Solid application-client context was introduced.

## Implementation Update — 2026-07-13 21:48:51 CEST

The first follow-on batch migrated the remaining simple user-triggered captured
operations selected for this phase:

- `jj git push`, preserving remote, bookmark, all, tracked, deleted,
  description, private, revision, change, and dry-run options
- `jj undo`
- `jj redo`

`Jj` now has one shared captured-command implementation for environment policy,
scoped execution, typed exit interpretation, output observation, and
interruption reporting. The application client likewise has one Promise adapter
for diagnostics, command-log compatibility, cancellation, and legacy result
translation. Each operation still captures its repository path at invocation.

The Solid call sites now invoke `app.jjGitPush`, `app.jjUndo`, and `app.jjRedo`
directly. They no longer install the mutable `activeObserver`, so this batch also
removes the command-log contamination race from these user workflows. Legacy
push helpers remain for stack and panel callers and are intentionally unchanged.

Verification evidence:

- `bun test`: 317 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: 10 passing terminal workflows, including undo
- repeated three-run benchmark evidence showed 1730 ms median startup and
  830 ms median fetch, within the existing run-to-run variation

This completes the simple user-triggered captured-mutation batch, not all
captured jj execution. Non-streaming reads, panel-specific pushes, hook-backed
mutations, workspace repair, and other legacy operations remain under item 1
below. Log and bookmark status reads are still callback-streaming legacy
operations and belong to item 2.

## Implementation Update — 2026-07-13 22:03:11 CEST

Two further captured-command batches are complete.

The first migrated panel bookmark/change pushes, operation restore, and workspace
repair. Startup repair and in-app stale-working-copy repair now share the owned
application client. Because nested panels became real application-client
consumers, the stable Promise-facing client is now supplied through a narrow
Solid `ApplicationProvider`; Effect environments and runtime execution remain
outside Solid.

The second migrated non-interactive edit, describe, squash, rebase, and bookmark
create/set/delete/rename/forget operations. Existing immutable-operation probes,
confirmation retries, selection restoration, refresh behavior, bookmark
backwards handling, and sanitized describe display commands are preserved.
Interactive squash remains on its inherited-stdio implementation.

The legacy functions remain temporarily for stack and other unchanged callers,
but migrated panel paths no longer install `activeObserver`. Verification now
covers all argument policies through the fake `AppProcess`; `bun test` reports
323 passing tests, all 10 terminal workflows pass, and benchmark medians were
1665 ms startup and 774 ms fetch with no material regression.

## Implementation Update — 2026-07-14 00:19:54 CEST

The remaining safe captured-command batch is complete:

- migrated duplicate, abandon, and file restore, including immutable-abandon
  confirmation and post-operation selection behavior
- migrated in-trunk probes, description reads, nearest-ancestor bookmark reads,
  and repository refresh-state polling
- split `Jj` execution into raw normal-exit capture and domain success policy so
  read capabilities can preserve their existing non-zero semantics without
  treating normal exits as lifecycle failures
- preserved typed stale-working-copy failures for refresh polling and moved all
  three `SyncProvider` refresh-state call sites through the owned application
  client

`withCommandObserver` and `activeObserver` now remain in one real UI path: the
hook-backed `new`, `new-before`, and `new-after` family in `LogPanel`. Those
commands are deferred until hooks move as a capability so configured pre-hooks
are not bypassed. Stack-specific fetch, push, rebase, abandon, operation-ID, and
revset calls also remain legacy until stack dependencies migrate together.

A follow-up correctness fix made stale-working-copy classification
result-aware. A matching diagnostic now counts as stale only when that same
command exited non-zero, preventing valid diff contents containing the literal
text “The working copy is stale” from failing files mode. Revision file loading
also captures and validates one stable revision identifier across each request.
The refactor and fix are separate jj changes.

Verification evidence:

- `bun test`: 329 passing tests
- `bun check` and targeted Biome checks pass
- `bun test:e2e`: 10 passing terminal workflows
- fresh-start files and diff mode were manually verified on the regression
  revision with Terminal Control

The next work is to finish remaining captured jj reads, then migrate hooks and
the `new` family to remove the mutable observer before designing scoped
streaming for log, bookmark, and diff reads.

## Work After Fetch

### 1. Consolidate captured jj execution

Move existing non-interactive jj reads and mutations behind `Jj` and
`AppProcess`, capability by capability. Keep Promise adapters for unchanged
callers. Delete duplicated stream readers and result constructors only after the
last caller moves.

Add bounded-output policy where the domain operation can choose an appropriate
limit. Large log and diff parsers must not be silently truncated.

### 2. Migrate streaming reads

Replace callback-based `executeStreaming` internals with scoped Effect programs.
Preserve incremental parsing, cancellation, decoder-tail behavior, and UI
batching. Navigating away or changing selection should interrupt obsolete work
without stale completion callbacks.

This step should settle the streaming interface and backpressure policy with a
real log or diff caller.

### 3. Migrate gh, git, and hooks

Reuse the process lifecycle implementation while keeping domain policy in
adapters:

- GitHub owns gh arguments, optional stdin, JSON parsing, and authentication or
  command failures.
- Git helpers own their silent-probe behavior where it is still intentional.
- Hooks retain an explicit `sh -lc` capability for configured shell commands and
  preserve sequential execution.

Do not force interactive editors, clipboard writes, updater pipelines, or
synchronous startup checks through an interface designed only for captured
commands. Migrate them later if a shared capability is demonstrated.

### 4. Migrate repository health and stack workflows

Build `RepositoryHealth` over `Jj`. Then migrate stack preparation and apply to
supplied `Jj`, `GitHub`, and journal implementations.

Keep stack discovery and planning pure. Before Effect-native stack apply ships:

- validate that a previewed plan is still fresh
- write a journal header before the first mutation
- durably append each completed mutation before starting the next
- return structured partial-failure evidence
- reject or serialize concurrent apply for the same repository
- remove direct runtime execution from panels

### 5. Remove compatibility code

After callers have migrated:

- remove the mutable global observer
- remove migrated direct `Bun.spawn` and Bun shell paths
- remove callback streaming adapters
- remove scattered runtime execution
- remove `success` booleans from Effect-native results
- remove Promise adapters with no remaining callers

The end state has one captured-process lifecycle implementation, explicit
runtime ownership, supplied domain dependencies, and no Effect-shaped Promise
workflows in migrated modules.

## Deferred Decisions

These do not block the first implementation. Resolve each when its first real
caller makes the tradeoff concrete:

- whether capture limits retain the beginning, end, or both
- process-group termination and the grace period for git or SSH descendants
- the final streaming interface and backpressure policy
- whether interactive commands belong on `AppProcess` or a separate capability
- how CLI commands share layer construction
- which successful warnings become persistent notices
- whether operation data eventually needs fan-out beyond one explicit sink

Process-group behavior is the only deferred item that can block completion of
the fetch slice: cancellation and shutdown must not leave observed git or SSH
descendants running.

## Review Gates

Each migration slice must be independently reviewable and leave the application
working. Require:

- focused unit and live process contract tests
- fake-layer tests for domain command construction and failure policy
- `bun test`
- `bun check`
- changed files passing Biome
- no loss of output or error visibility
- no duplicate command-log entries
- no new unscoped long-running process
- no new direct Effect runtime execution in Solid components
- before/after TUI benchmark evidence for changes that touch application startup
  or interactive operation paths
