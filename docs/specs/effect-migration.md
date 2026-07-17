# Effect v4 Migration

## Status

**Complete.** Repository-domain process execution now runs through scoped Effect
capabilities. Captured commands use `AppProcess`; inherited-stdio jj commands use
the separate `InteractiveProcess`; and `Jj`, `Git`, `GitHub`, `Hooks`,
`RepositoryBootstrap`, and `Stack` own their domain policies. The TUI and CLI
consume a Promise-facing `ApplicationClient`, and Solid owns no Effect runtime,
environment, fiber, or scope.

The legacy executor, global observer, commander compatibility wrappers, and
their obsolete adapter tests have been removed. The only direct subprocesses
outside the two owned process capabilities are explicit local OS integrations
for editor launching and clipboard writes.

Kajji currently pins `effect@4.0.0-beta.98`. Upgrade it as a deliberate,
separately validated change rather than combining lifecycle API changes with
unrelated product work.

This document records the architecture, original rollout plan, and timestamped
implementation history. Post-migration review candidates and the Effect CLI
exploration live in [Effect Post-Migration Review](./effect-post-migration.md).

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
- Migrating every process family in one change.
- Designing a universal event bus.
- Adding Node support or a second process implementation without a real need.
- Redesigning notices, error screens, or command-log UX as part of process
  ownership migration.
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
layout. Those decisions were subsequently settled through working slices and
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
Jj / Git / GitHub / Hooks / RepositoryBootstrap / Stack / InteractiveJj
      |
AppProcess / InteractiveProcess / StackStore / operation sink
```

Solid code calls a narrow application client and receives ordinary values or
Promises. It does not assemble layers, supply Effect environments, or call
`Effect.runPromise` directly.

Pure parsers and planners sit beside this graph. Domain modules call them without
turning them into services.

### Corroborating architecture: OpenCode V2

OpenCode V2 independently uses the same operational boundary. Its generated
client has two entry points: a zero-Effect Promise client with structural values
and a rich Effect client with typed Effects, Streams, schemas, and an injected
HTTP client. Its Effect-native embedded SDK is intended specifically for
applications already built around Effect and owns its in-process host through an
Effect Scope. See the V2 source at commit
[`9b8282ad3`](https://github.com/anomalyco/opencode/tree/9b8282ad3db97bd2f4dc7ba2dede5aaebbd9b2fc):

- [the two client entry points and their dependency boundaries](https://github.com/anomalyco/opencode/blob/9b8282ad3db97bd2f4dc7ba2dede5aaebbd9b2fc/packages/client/README.md#L5-L14)
- [the scoped Effect-native embedded SDK](https://github.com/anomalyco/opencode/blob/9b8282ad3db97bd2f4dc7ba2dede5aaebbd9b2fc/packages/sdk-next/src/opencode.ts#L7-L39)
- [the published V2 SDK guidance](https://v2.opencode.ai/build/sdk)

Most relevantly, OpenCode's Solid TUI is launched inside a scoped Effect program,
but it creates the Promise client before render and supplies that client through
a Solid provider. The provider accepts Promises, `AbortController`, and async
iterables rather than Effect environments or runtime services
([composition root](https://github.com/anomalyco/opencode/blob/9b8282ad3db97bd2f4dc7ba2dede5aaebbd9b2fc/packages/tui/src/app.tsx#L179-L203),
[provider wiring](https://github.com/anomalyco/opencode/blob/9b8282ad3db97bd2f4dc7ba2dede5aaebbd9b2fc/packages/tui/src/app.tsx#L265-L339),
[client context](https://github.com/anomalyco/opencode/blob/9b8282ad3db97bd2f4dc7ba2dede5aaebbd9b2fc/packages/tui/src/context/client.tsx#L1-L35)).

This evidence refines “Effect-less Solid” rather than making it absolute.
OpenCode does use pure Effect data utilities such as `Data.TaggedClass` and
`Equal` inside [UI models](https://github.com/anomalyco/opencode/blob/9b8282ad3db97bd2f4dc7ba2dede5aaebbd9b2fc/packages/app/src/pages/session/timeline/timeline-row.ts#L1-L43),
and occasionally runs a [self-contained Effect utility from a Solid
resource](https://github.com/anomalyco/opencode/blob/9b8282ad3db97bd2f4dc7ba2dede5aaebbd9b2fc/packages/app/src/app.tsx#L410-L423).
The important boundary is that Solid does not own the application runtime,
assemble service environments, manage scoped application resources, or receive
Effect-returning client operations. Kajji keeps the stricter rule of no direct
runtime execution in Solid because its owned `ApplicationClient` already
provides the appropriate edge.

### Tagged data at the boundary

Effect tagged enums provide constructors, exhaustive `$match`, tag guards,
structural equality, and hashing. Those are useful for a closed domain union that
is reused broadly, stored in Effect collections, or expected to gain variants.
They are not automatically preferable for every discriminated input.

Use ordinary structural unions for small command argument shapes when their
fields already distinguish the cases. For example, revision and range are two
inputs to one diff capability, so `JjDiffTarget` is intentionally:

```ts
type JjDiffTarget =
    | { readonly revision: string }
    | { readonly from: string; readonly to: string }
```

This keeps call sites ordinary at the Promise boundary and avoids requiring
Solid code to construct Effect data values. Use tagged errors and tagged domain
values when the tag enables distinct recovery, exhaustive behavior, or value
semantics. `JjStaleWorkingCopyError` remains separate because callers can repair
and retry it; `JjReadError` uses a capability discriminator because normal read
failures share one failure type but need stable capability-specific context.

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
jj-specific results or typed errors. Bookmark, file, log, diff, and operation-log
parsers remain ordinary pure modules beside the service.

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

Effect implementations are the source of truth. The Promise-facing application
client translates typed service results into structural values for the TUI and
CLI; no legacy process compatibility path remains.

Commands use an explicit, infallible operation sink. Do not introduce a queue,
`PubSub`, or application-wide event bus until multiple real consumers require
fan-out. The application edge translates sink events into the existing
`CommandObserver`: one user operation produces exactly one visible command-log
entry, and observer failure never fails the underlying command.

## Historical Rollout Plan: First Slice (`jj git fetch`)

The first slice proved the architecture end to end without stack mutation. Fetch
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

## Implementation Update — 2026-07-14 11:02:52 CEST

The non-streaming TUI read batch is complete. Revision and range file lists,
colored and parsed diffs, commit details, bounded operation logs, remote
bookmarks, and captured revset log pages now run through `Jj` and the owned
`ApplicationClient`. The Solid layer still sees only Promises and parsed domain
values.

This batch preserves fileset construction, `COLUMNS` handling, binary-file
detection, log pagination by requesting one extra commit, ANSI bookmark/log
parsing, stale-working-copy classification, and the legacy Promise error text at
the application boundary. File summary and binary detection still run
concurrently under the operation scope. Detail selection and files requests keep
their existing stale-result guards.

Legacy captured wrappers remain for stack workflows and standalone CLI commands;
they are not routed through a hidden runtime. The main log, local bookmark, and
streaming diff paths also remain on `executeStreaming` for the dedicated scoped
streaming phase.

Verification evidence:

- `bun test`: 332 passing tests before the final bookmark/log additions, with
  focused `Jj` and `ApplicationClient` suites passing after them
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass, including revision detail,
  files, diff, undo, bookmark, and resize behavior

The next batch is hooks plus `new`, `new-before`, and `new-after`, which should
remove the final real UI ownership of `activeObserver`. Scoped streaming follows.

## Implementation Update — 2026-07-16 15:22:30 CEST

The hooks and `jj new` batch is complete. Configured shell hooks, Git
`pre-commit` hook discovery, and executable hooks now run through a scoped
`Hooks` service over `AppProcess`. Hook commands remain sequential, configured
environment overrides are preserved, shell commands retain the explicit
`sh -lc` capability, and direct hooks retain executable-bit checks. Process
failures and interruption are reported through the same operation-local sink as
the owning jj command.

`new`, `new-before`, and `new-after` now run through `Jj` and the Promise-facing
`ApplicationClient`. Pre-hook failures still prevent `jj new`, retain the failed
hook's output and exit code, and emit the existing skip diagnostic. Explicit
`--no-verify` still skips both configured and Git hooks.

The new-options menu now asks the hooks capability whether the current repository
has an applicable configured hook. It shows `--no-verify` only when a
configured shell hook or executable Git `pre-commit` hook would actually run.
Hook discovery failures conservatively omit the option instead of blocking the
menu.

There are no remaining `withCommandObserver` or `activeObserver` callers, so the
mutable global observer and compatibility wrapper have been removed. Legacy
commands that still use `execute` must now pass observers explicitly.

Verification evidence:

- `bun test`: 360 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass
- Terminal Control verified that the new-options menu omits `--no-verify`
  without hooks and shows it after configuring an executable Git `pre-commit`
  hook in the same repository

Scoped streaming for log, bookmark, and diff reads is the next architectural
phase.

## Implementation Update — 2026-07-16 17:07:35 CEST

The scoped streaming phase is complete for the live TUI paths. Log pages and
local bookmarks now stream through `Jj`, `AppProcess`, and the owned
`ApplicationClient` runtime. The application boundary returns a cancelable
handle with a completion Promise and one backpressured batch consumer; Solid
still owns no Effect runtime, service, fiber, or scope.

`AppProcess` now waits for asynchronous output consumers before pulling the next
chunk. This makes backpressure explicit while retaining concurrent stdout and
stderr draining, incremental `TextDecoder` tails, timeout policy, process-group
termination, and scope finalization. `Jj` incrementally parses complete log
records and complete bookmark lines, emits bounded visible batches, and applies
the same typed stale/read failure policy as captured reads. Final results still
carry pagination evidence through the existing limit-plus-one policy.

`SyncProvider` now awaits stream completion directly and uses operation-local
abort controllers plus request tokens. Superseded refreshes, filters, load-more
requests, and provider disposal interrupt their scoped process and ignore stale
batches or completion. The old callback completion/error bookkeeping is gone.

No live diff caller remained on the legacy streaming path: revision and range
diffs already use the captured `Jj.diff` capability. The dead diff stream,
bookmark stream, log stream wrappers, and `executeStreaming` implementation
have therefore been removed.

Verification evidence:

- `bun test`: 365 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass
- focused tests cover output backpressure, incremental chunk boundaries, stream
  cancellation, pagination, and final parsing
- Terminal Control verified a fresh TUI load, streamed revisions/bookmarks, and
  a filter-driven log reload

The next migration phase is gh and git process ownership, followed by repository
health and stack workflows. Remaining legacy captured wrappers and parser/template
imports can be removed as their CLI and stack callers migrate.

## Implementation Update — 2026-07-16 18:48:40 CEST

The first gh/git ownership slice is complete. A narrow `Git` capability now owns
silent origin-remote lookup, and a scoped `GitHub` capability owns repository
resolution, PR discovery, and the TUI's browser-opening gh operations. Both run
through `AppProcess`; no migrated GitHub path spawns directly.

`AppProcess` now supports optional captured stdin with typed write failures, so
later GraphQL or comment operations do not need a second process lifecycle.
GitHub output observation remains operation-local and uses the existing command
log sink with the `shell` command kind. Repository resolution still prefers a
parseable GitHub origin and falls back to `gh repo view`; PR lookup preserves
head de-duplication, closed/merged policy, and existing JSON parsing.

`SyncProvider`, `LogPanel`, and `BookmarksPanel` now use Promise-facing
`ApplicationClient` methods. PR metadata refreshes are abortable when their
reactive owner is replaced, while browser operations preserve command output,
exit status, diagnostics, and exactly-once command-log completion.

The legacy functions in `commander/github.ts` remain for stack execution only.
They will be removed when stack workflows receive supplied `GitHub` and journal
dependencies rather than acquiring a hidden runtime or partially migrating the
stack transaction.

Verification evidence:

- `bun test`: 372 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass
- `bun test:bench`: all 26 benchmark assertions pass
- focused tests cover stdin delivery, origin-based repository resolution,
  GraphQL command construction, operation-local output observation, and the
  Promise client boundary

The next slice is repository health over supplied process capabilities, followed
by stack preparation and apply over supplied `Jj`, `GitHub`, and journal
implementations.

## Implementation Update — 2026-07-16 22:07:23 CEST

Repository bootstrap now runs through a supplied `RepositoryBootstrap`
capability over `Jj` and `Git`. Repository-root discovery, Git repository
detection, stale
working-copy startup checks, and `jj git init` variants all use the owned
`AppProcess` lifecycle. The synchronous `spawnSync` startup path and the legacy
`utils/repo-check.ts` adapter have been removed.

The Promise-facing `ApplicationClient` exposes structural repository status and
initialization results. `runTui` resolves initial status before rendering, while
repository selection and startup retries reuse the same capability. Process
spawn/read/timeout failures retain the previous conservative startup behavior:
failed probes do not prevent the startup screen from rendering.

Refresh-state polling now preflights `jj status` before reading operation and
working-copy IDs. This catches stale working copies on the normal focused poll,
focus refresh, initial refresh-state read, and full-refresh path even when the
other metadata reads would succeed. Stale errors now show the existing repair
screen even when revisions are already loaded, so an externally stale workspace
cannot remain only as command-log output while old data stays visible.

Verification evidence:

- `bun test`: 377 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass
- three-run TUI benchmark medians were 2174 ms startup and 605 ms fetch,
  compared with 2205 ms and 595 ms on the parent revision
- focused tests cover root normalization, Git detection, colocated init,
  startup stale reporting, and refresh preflight short-circuiting

Repository bootstrap is complete. Stack preparation and apply over supplied `Jj`,
`GitHub`, and journal dependencies is the next major migration phase.

## Implementation Update — 2026-07-16 23:21:14 CEST

The stack migration is complete. A scoped `Stack` capability now owns sync-plan
preparation and apply over supplied `Jj`, `GitHub`, and `StackStore`
dependencies. Preparation preserves the existing fetch/reconciliation behavior,
closed and merged PR discovery, persisted bookmark restoration, and landed-range
probes. Stack execution no longer wraps legacy Promise commands in
`Effect.promise`.

Apply now re-reads repository, PR, and persisted state and rejects a preview
whose bookmark revisions, desired bases, PR numbers, or planned effects changed.
This validation does not perform another mutating fetch. A runtime-owned
per-repository semaphore serializes applies so two stack transactions cannot
interleave.

Before the first planned mutation, apply durably writes a journal header. Each
completed mutation is added through a temporary-file write, file sync, atomic
rename, and directory sync before the next mutation starts. Failures return a
`StackApplyError` containing only entries that were durably recorded. Persisted
stack state and the final operation ID are written after all planned effects
complete.

The Promise-facing `ApplicationClient` now exposes persisted-parent lookup,
stack preparation, and stack apply. `BookmarksPanel` no longer executes Effect
programs or reads stack state directly. Stack output observation remains
operation-local through the supplied sink.

The old direct-spawn GitHub implementations and stack-only jj wrappers have been
removed. `commander/github.ts` now contains only shared structural types and pure
parsers; GitHub execution lives in the scoped `GitHub` service.

Verification evidence:

- `bun test`: 378 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass
- `bun test:bench`: all 26 benchmark assertions pass
- focused stack tests cover supplied dependency routing, stale-plan rejection,
  durable journal progression, structured partial failures, per-repository
  serialization, and the Promise client boundary

The last major transactional migration is complete. Remaining work is limited to
standalone CLI ownership, interactive-process policy, and deletion of legacy
compatibility code after their final callers move.

## Implementation Update — 2026-07-16 23:39:20 CEST

Standalone CLI process ownership is migrated. `runCli` now constructs one owned
`ApplicationClient`, injects its narrow structural capability into the command
definitions, and disposes it after command completion. CLI modules neither
acquire an Effect runtime nor invoke the legacy commander executor.

`Jj` now owns typed repository-root resolution, arbitrary revision-summary
listing, and captured file-content reads. The existing captured diff capability
supplies comment relocation and changes output, while pure diff parsing remains
outside the process service. CLI callers preserve `Not a jj repository`,
underlying stderr, and empty-root error behavior; `RepositoryBootstrap` converts
the same typed root failure into the conservative absence used by startup
probing.

Comment storage is now process-free. Revision, file-content, root, and diff
operations all flow through `AppProcess`; CLI output formatting, line context,
comment relocation, hunk IDs, JSON shapes, and confirmation behavior are
unchanged.

Verification evidence:

- `bun test`: 381 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass
- live `kajji changes -r @ --json` and `kajji comment list -r @ --json`
  commands completed successfully through the owned client

Standalone CLI ownership is complete. Remaining migration work is now limited
to interactive-process policy and final compatibility cleanup.

## Implementation Update — 2026-07-17 18:27:00 CEST

Interactive jj process ownership is migrated. Split, resolve, and interactive
squash now run through a scoped `InteractiveProcess` capability and an
`InteractiveJj` domain service. The separate process capability preserves
inherited stdin, stdout, and stderr without widening captured `AppProcess` or
forcing terminal commands through captured-output policy.

The Promise-facing `ApplicationClient` exposes structural interactive results,
while Solid continues to own renderer suspension, immutable confirmation,
refresh, selection, operation-log reloads, and the existing manual resolve
command-log entry. Normal non-zero exits preserve the prior operation-specific
messages. Spawn failures remain typed inside Effect, and runtime disposal or
request cancellation interrupts and reaps the inherited-stdio child.

The old direct `Bun.spawn` implementations have been removed from
`commander/operations.ts`. Log projection now also carries jj's conflict state,
so Resolve remains available in the command palette for every revision but is
promoted to the status bar only when the selected revision has conflicts.
Focused tests cover argument construction, client routing, conflict parsing,
normal non-zero exits, typed spawn failures, and fiber interruption.

Verification evidence:

- `bun test`: 388 passing tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass
- `bun test:bench`: all 26 benchmark assertions pass
- Terminal Control verified resolve through the command palette, inherited-stdio
  completion, renderer resumption, command-log reporting, and refresh; a real
  conflicted repository also showed Resolve only while the conflicted revision
  was selected

Editor launching and clipboard writes remain explicit OS/UI integrations rather
than repository-domain process capabilities. Effect CLI adoption and diff
virtualization work also remain separate decisions.

## Implementation Update — 2026-07-17 19:00:02 CEST

Final compatibility cleanup is complete. The legacy
`commander/executor.ts`, captured wrappers in `commander/operations.ts`, the
obsolete `commander/diff.ts` adapter, and their mock-based compatibility tests
have been deleted. Bookmark, file, log, and diff modules now retain only the
structural models, templates, argument builders, and parsers used by the scoped
services.

Promise-facing operation results now have one neutral structural definition in
`process/operation-result.ts`; Effect-native services continue to use
`ProcessResult` and typed failures internally. Operation-log parsing has moved
to a dedicated pure module, diff statistics live with diff view types, and
immutable-result classification lives with the other jj error policies.

Stack discovery is now an ordinary pure function instead of an Effect-wrapped
calculation. Solid no longer invokes `Effect.runSync`; it consumes the same pure
stack model directly while all lifecycle-bearing Effect execution remains in
the application runtime.

The remaining direct subprocesses are the two owned process capabilities plus
the explicitly local editor and clipboard OS integrations. There is no direct
jj, git, gh, or hook execution outside supplied services, and no Effect runtime
execution in Solid components.

Verification evidence:

- `bun test`: 326 passing focused unit tests after removing 62 obsolete adapter
  tests
- `bun check` and changed-file Biome checks pass
- `bun test:e2e`: all 10 terminal workflows pass
- `bun test:bench`: all 26 benchmark assertions pass

The Effect migration is complete. Follow-up product, performance, and optional
architecture work is tracked separately.

## Post-Migration Work

The migration is finished; remaining architecture review, optional module
extractions, unresolved process-policy questions, and the Effect CLI evaluation
are tracked in
[Effect Post-Migration Review](./effect-post-migration.md). Diff virtualization
and scrolling performance remain separate product-performance work.

## Historical Review Gates

Each migration slice was required to be independently reviewable and leave the
application working. The gates were:

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
