# Effect v4 Architecture and Migration

## Status

**Draft / work in progress.** This document is an exploratory design proposal.
It has not been approved as Kajji's final architecture, and none of its API,
boundary, sequencing, or implementation decisions should be treated as settled.
Future work should validate its assumptions and explicitly resolve its open
questions before relying on it as an implementation specification.

This document explores a possible architecture and staged migration of Kajji's
asynchronous backend to Effect v4. It supersedes the earlier exploratory Effect
migration notes without making this proposal authoritative.

Kajji currently pins `effect@4.0.0-beta.65`. This version corresponds to the
Effect v4 `effect-smol` line and differs in important ways from Effect v3. Keep
the version pinned while a migration slice is in progress and verify APIs
against the matching source before upgrading.

The migration is incremental. It is not a rewrite of the TUI and it is not an
attempt to use Effect in every module.

## Motivation

Kajji grew from a TUI experiment into a useful application. Its largest quality
issues now come from unclear ownership at asynchronous boundaries:

- process execution is duplicated across jj, gh, hooks, updates, editors, and
  repository checks
- process failures, non-zero exits, warnings, and unexpected exceptions have
  inconsistent semantics
- cancellation and timeout cleanup are mostly manual
- background work and user operations are coordinated in large UI contexts
- command logging depends on a mutable global observer
- stack code uses Effect wrappers but still imports Promise-based dependencies
- tests mock modules rather than supplying deterministic service layers
- important successful stderr and recoverable failures are not consistently
  surfaced to the user

Effect is useful here because these concerns involve scoped resources, typed
failures, structured concurrency, interruption, dependency injection, and test
implementations. Effect is not expected to improve rendering or local UI state.

## Goals

- Give Kajji one interruption-safe process execution model.
- Preserve stdout and stderr, including warnings from successful commands.
- Distinguish process lifecycle failures from command exit failures.
- Make jj, GitHub, and stack workflows testable with fake layers.
- Own one Effect runtime at the application boundary.
- Keep Solid/OpenTUI code signal and event driven.
- Replace implicit global observation with explicit operation events.
- Provide structured evidence for command logs, diagnostics, and notices.
- Preserve existing behavior through temporary Promise adapters.
- Improve stack mutation safety through freshness checks and durable journaling.

## Non-goals

- Rewriting Solid/OpenTUI components as Effect services.
- Moving focus, keybind, modal, layout, or local selection state into Effect.
- Wrapping pure parsers, planners, and formatting helpers in Effect.
- Redesigning all error and notification UI as part of the process migration.
- Logging every internal command in the visible command log.
- Creating a universal application event-sourcing system.
- Keeping legacy APIs indefinitely after their consumers have migrated.

## Current State

The first stack slice uses `Effect.fn`, `Effect.succeed`, `Effect.promise`, and
direct `Effect.runPromise` or `Effect.runSync` calls. This is a useful
experiment, but it is not yet an Effect-native subsystem:

- `src/stack/executor.ts` wraps large rejecting Promise workflows in
  `Effect.promise`
- stack dependencies are direct imports rather than services
- failures are thrown as ordinary `Error` values
- `success` booleans are inspected inside Effect workflows
- tests replace imported modules rather than providing layers
- runtime execution occurs in UI components
- process cancellation is not scoped to the stack operation

`Effect.promise` must only wrap Promises that cannot reject. A rejected Promise
becomes a defect rather than a typed failure. Existing rejecting APIs should be
adapted with `Effect.tryPromise` until they are replaced.

Pure stack discovery and planning should remain ordinary synchronous functions.
An Effect wrapper is only useful when a function requires services,
concurrency, interruption, tracing, or a typed error channel.

## Architectural Boundary

The intended dependency direction is:

```text
OpenTUI components
        |
Solid stores and controllers
        |
UI-facing application client
        |
Kajji ManagedRuntime
        |
Application workflows
        |
Jj / GitHub / RepositoryHealth / StackJournal
        |
AppProcess / OperationEvents
```

Solid components do not assemble layers or depend on Effect environments. The
application client starts Effect programs through the owned runtime and maps
their outcomes to Solid state.

Pure parsing and planning modules sit beside this graph and are called by
services or workflows without becoming services themselves.

## Effect v4 Conventions

These conventions target `effect@4.0.0-beta.65`.

### Services

Use `Context.Service`, not Effect v3 `Context.Tag` examples and not newer
`ServiceMap.Service` examples that are unavailable in the pinned release.

```ts
import { Context, Effect, Layer } from "effect"

interface AppProcessShape {
    readonly run: (
        command: ProcessCommand,
    ) => Effect.Effect<ProcessResult, ProcessLifecycleError>
}

class AppProcess extends Context.Service<AppProcess, AppProcessShape>()(
    "kajji/AppProcess",
) {}

const AppProcessLive = Layer.succeed(AppProcess)({
    run: Effect.fn("AppProcess.run")((command) => runBunProcess(command)),
})
```

Use `Layer.succeed(Service)(implementation)` for constructed implementations
and `Layer.effect(Service)(effect)` for Effect-created implementations. In this
Effect v4 version, `Layer.effect` replaces the older scoped-layer pattern.

### Runtime

Create one `ManagedRuntime` per Kajji invocation:

- the TUI creates and owns one runtime in its composition root
- CLI entry points create a runtime with the layers they need
- tests provide layers directly and usually do not create a global runtime
- normal quit, SIGINT, and SIGTERM interrupt active work and dispose the runtime
  before renderer destruction or process exit

Only application edges run Effects. Avoid scattered `Effect.runPromise` and
`Effect.runSync` calls in components and service implementations.

### Tracing

Use `Effect.fn("Namespace.operation")` for exported service methods and major
workflows. Do not trace tiny pure helpers merely for consistency.

### Typed errors

Use `Schema.TaggedErrorClass` for stable, inspectable errors that cross service
boundaries. Do not force every unexpected exception into a domain error.
Unexpected defects retain their cause and are handled by the runtime diagnostics
boundary.

### Resource safety

Acquire each child process with `Effect.acquireRelease` inside an
`Effect.scoped` command operation. The release finalizer must be infallible and
must terminate and reap a still-running child.

Use `Stream.fromReadableStream` with its v4 options-object API when adapting Bun
Web streams. stdout and stderr must be consumed once, concurrently, and retain
their stream identity.

Use Effect interruption as the primary internal cancellation mechanism. An
`AbortSignal` is an interoperability mechanism at Promise/UI boundaries, not
the process lifecycle model.

### Platform choice

Do not add `@effect/platform-bun` only for child processes at the pinned
version. Its child-process implementation currently delegates to the Node
implementation rather than `Bun.spawn`. Kajji should implement a small
Bun-backed service and revisit the platform package if it later needs a broader
platform abstraction.

## Runtime Ownership and Shutdown

The TUI composition root should construct a small live layer and expose a narrow
application client. The exact module names may change, but runtime ownership
must remain explicit.

```text
src/effect/runtime.ts
src/effect/layers.ts
src/effect/client.ts
```

The shutdown sequence is:

1. Stop accepting new application operations.
2. Interrupt active operation fibers.
3. Dispose the `ManagedRuntime` and its scopes.
4. Destroy the OpenTUI renderer.
5. Set the exit code or exit the process.

Direct `process.exit()` calls must not bypass runtime disposal after the runtime
is introduced.

Repository identity must be captured at operation start. Long-running programs
must use an explicit `repoPath` rather than repeatedly reading mutable global
repository state after Kajji switches repositories.

## AppProcess

`AppProcess` is executable-neutral infrastructure. It must not contain jj,
GitHub, command-log visibility, or UI error policy.

Suggested location:

```text
src/process/AppProcess.ts
src/process/errors.ts
src/process/types.ts
src/process/layers/Live.ts
src/process/layers/Test.ts
```

### Command model

```ts
interface ProcessCommand {
    readonly executable: string
    readonly args: readonly string[]
    readonly displayCommand: string
    readonly cwd: string
    readonly env?: Readonly<Record<string, string>>
    readonly stdin?: ProcessInput
    readonly output?: "capture" | "stream" | "inherit"
    readonly timeout?: Duration.Duration
    readonly metadata?: ProcessMetadata
}
```

Arguments are passed as an argv array. Shell strings are only accepted by an
explicit shell capability for user-configured hooks or existing install-script
pipelines. Display text must not be reused as executable input.

Environment variables, stdin, and sensitive arguments must not be copied into
logs by default.

### Result semantics

`AppProcess.run` returns a result for every normal process exit, including a
non-zero exit code:

```ts
interface ProcessResult {
    readonly stdout: string
    readonly stderr: string
    readonly exitCode: number
    readonly durationMs: number
    readonly stdoutTruncated: boolean
    readonly stderrTruncated: boolean
}
```

The result does not contain a redundant `success` boolean in Effect-native code.
Callers inspect or validate the exit code.

`AppProcess.runChecked` may be a convenience that converts a non-zero exit into
a `ProcessExitError`. Domain services should normally use checked execution,
while commands with meaningful non-zero exit codes can use raw execution.

### Error semantics

Process lifecycle failures are separate from normal command exits:

- `ProcessSpawnError`: the executable could not be started
- `ProcessReadError`: stdout or stderr could not be consumed
- `ProcessWriteError`: stdin could not be written
- `ProcessTimeoutError`: the configured deadline expired
- `ProcessExitError`: optional checked-execution error for a non-zero exit

Errors preserve bounded diagnostic evidence:

- executable and arguments, with redaction support
- cwd
- exit code when available
- bounded stdout and stderr when available
- timeout or signal details
- underlying cause for diagnostics

Interruption remains interruption. It should not normally be converted into an
error notice.

### Output and memory

stdout and stderr are captured separately. The process layer must define limits
for captured output so a child cannot grow memory without bound. Results include
truncation flags and preserve the most diagnostically useful portion of output.

Streaming is opt-in. It publishes chunks while retaining bounded captured output
for the final result. Stream consumers must not be able to prevent process pipes
from draining indefinitely.

### Cancellation and timeout

On interruption or timeout, the scoped finalizer should:

1. Stop publishing output events.
2. Request process termination.
3. Wait for exit for a short grace period.
4. Force termination if required and supported.
5. Release readers and handles.

Timeout defaults belong to domain commands, not to `AppProcess` globally.
Interactive commands and long-running network commands have different policies.

## Operation Events

Operation events are structured facts about work. They replace the mutable
module-level `activeObserver` over time.

```ts
type OperationEvent =
    | OperationStarted
    | OperationOutput
    | OperationFinished
    | OperationFailed
    | OperationTimedOut
```

Events should carry:

- operation ID
- parent operation ID when applicable
- sequence number
- timestamp
- repository path
- operation kind
- display command or semantic operation name
- stdout versus stderr for output chunks
- exit code and duration for completion
- visibility metadata

Event publication is best-effort and must not fail the operation. The final
`ProcessResult` or domain result remains the source of truth for complete
captured output.

Start with a single event sink or bounded queue. Use `PubSub` only if Kajji has
real fan-out requirements. A bounded `PubSub` allows one slow subscriber to
backpressure every publisher. Any dropping or sliding policy must be explicit,
and loss of important events should itself be recorded in diagnostics.

The existing `CommandObserver` remains as a temporary compatibility adapter.
An operation must produce exactly one visible command-log entry, not one from
the new event path and another from a legacy adapter.

## Domain Services

### Jj

The `Jj` service owns jj-specific command construction, exit interpretation,
and parser invocation. It uses `AppProcess` and emits semantic errors rather
than exposing raw process policy to every caller.

Initial capabilities:

- fetch and parse log pages
- fetch and parse bookmarks
- fetch and parse diffs and file summaries
- fetch operation and working-copy IDs
- fetch repository status and warnings
- run mutations such as fetch, push, rebase, abandon, and describe
- run interactive split, squash, and resolve operations

Pure parser functions remain ordinary modules. `Jj` maps parser failures to
typed errors such as `JjParseError` and command failures to `JjCommandError`.

Successful stderr is retained as result data and can produce structured command
diagnostics. A zero exit code does not imply that stderr is irrelevant.

### GitHub

The `GitHub` service owns git/gh repository resolution, command construction,
JSON parsing, and GitHub-specific errors.

Initial capabilities:

- resolve the GitHub repository
- look up pull requests by bookmark head
- create a pull request
- retarget or close a pull request
- update a stack comment
- open a pull request or commit in the browser

The service must not silently translate authentication, command, or parse
failures into empty maps.

### RepositoryHealth

`RepositoryHealth` is a workflow over `Jj`, not process infrastructure. It runs
and interprets repository health checks such as `jj status --color never`.

It returns structured diagnostics while preserving raw output. Initial known
diagnostics include refused snapshots and other important successful warnings.
Parsing human-readable jj output must remain narrow and defensive.

### StackJournal

`StackJournal` persists facts about stack mutations:

- journal started with the source operation ID and plan identity
- bookmark pushed
- commit range rebased or abandoned
- pull request created
- pull request base changed
- pull request body or stack comment changed
- operation completed or failed

The journal header is written before the first mutation. Each successful
mutation is durably appended before the next mutation begins. Writing only after
the entire plan succeeds provides no recovery evidence for partial failure.

## Stack Architecture

Stack discovery and planning remain pure where possible. Stack preparation and
apply become application Effects requiring `Jj`, `GitHub`, `StackJournal`, and
operation-event capabilities.

Before applying a previewed plan:

- verify the repository path matches
- verify the relevant jj operation ID or state fingerprint
- verify GitHub state that materially affects the plan
- reject or re-plan stale work explicitly
- serialize or reject concurrent applies for the same repository

`StackApplyError` should include the failed plan step, journal ID, and completed
steps. A successful apply returns a report with applied steps, skipped steps,
warnings, and journal identity.

## Promise Compatibility Boundary

New Effect implementations are the source of truth. Existing Promise APIs may
temporarily adapt them for unchanged UI call sites.

Compatibility rules:

- new Effect code never imports a Promise adapter that runs the runtime
- adapters preserve existing result or rejection behavior at their public edge
- command logging remains once-only
- cancellation is exposed through an abort signal or operation handle where the
  existing consumer needs it
- each old spawn implementation is deleted when its adapter reaches parity
- adapters are removed after their consumers migrate

This prevents nested runtimes and prevents a permanent architecture where new
Effect code calls old Promises that call Effect again.

## Diagnostics and Error Surfacing

The Effect migration and the diagnostics UX are related, but they are not the
same project.

### Owned by this migration

- typed process and domain failures
- complete bounded stdout and stderr evidence
- successful-command diagnostics and warnings
- operation and correlation IDs
- structured lifecycle and failure events
- interruption and timeout classification
- defect and Cause capture at the runtime boundary
- emission of sanitized evidence to the single `DiagnosticsWriter` owned by the
  companion diagnostics architecture, without depending on `console.error`
- one edge translator from typed application outcomes to `AppDiagnostic` facts
- preservation of current error visibility during compatibility migration

These are backend prerequisites for trustworthy error presentation.

### Companion diagnostics UX track

The product semantics and presentation are specified in
[`diagnostics-and-notices.md`](./diagnostics-and-notices.md).

- transient versus persistent notice policy
- warning and error banners or toasts
- notice history and unread indicators
- details and copy-report views
- safe recovery actions
- repository-health presentation, including unsnapshotted files
- an application-owned fatal crash screen
- root Solid `ErrorBoundary`
- wrappers for exceptions swallowed by OpenTUI keyboard dispatch
- explicit `openConsoleOnError: false` and development-only console behavior

Effect cannot replace these UI mechanisms. It does not catch exceptions that
OpenTUI catches and swallows, and it does not decide how a warning should be
presented.

The companion specification remains independently reviewable and can ship in
slices alongside this migration. Dropping that work would leave structured
backend errors available but still poorly presented.

The migration acceptance criterion is surfacing parity. Expected failures must
not become less visible during migration. The broader notice and crash UX can
ship independently once the event and error data are available.

## OpenCode Reference

OpenCode is a useful reference because it is also migrating incrementally and
currently contains both Effect-native and legacy Promise process paths.

Relevant patterns from `anomalyco/opencode`:

- `packages/core/src/process.ts`: Effect-native process service, output
  collection, streaming, timeout, and process lifecycle
- `packages/opencode/src/effect/app-runtime.ts`: owned application runtime and
  layer composition
- `packages/opencode/src/effect/bridge.ts`: Effect-to-existing-application
  boundary
- `packages/opencode/src/effect/promise.ts`: refinement of Promise rejections
- `packages/opencode/src/effect/runner.ts`: operation coordination and
  cancellation
- `packages/core/src/event.ts`: typed event publication
- `packages/tui/src/util/error.ts`: edge-level error presentation mapping
- `packages/core/test/process/process.test.ts`: live process contract tests

Patterns not to copy wholesale:

- OpenCode's Node and cross-platform process adapter; Kajji should use
  `Bun.spawn`
- OpenCode's large application layer graph
- workspace AsyncLocalStorage bridges that Kajji does not need
- durable event sourcing for transient local UI operation events
- server/SDK event boundaries in a local single-process TUI

Use OpenCode's ownership and lifecycle principles, not its application scale.

## Test Strategy

### Process contract tests

The live `AppProcess` layer must cover:

- stdout and stderr capture with stream identity
- concurrent and chunked output
- non-zero normal exit
- missing executable or spawn failure
- stdin writing and closing
- cwd and environment
- decoder tails and non-ASCII chunk boundaries
- timeout cleanup
- explicit interruption cleanup
- child termination and reaping
- output bounds and truncation flags
- event ordering
- event-sink failure isolation
- interactive stdio behavior where supported

Use `TestClock` for Effect timeout and retry policy tests. Keep a small set of
real Bun subprocess tests for actual child-process behavior.

### Service tests

Use `Layer.succeed` fakes for `AppProcess`, `Jj`, `GitHub`, and `StackJournal`.
Cover success, command failure, authentication failure, malformed output,
cancellation, and warnings without invoking external tools.

### Stack safety tests

Before Effect-native stack apply ships, cover:

- stale plan rejection
- journal creation before mutation
- durable recording after each completed mutation
- failure after each mutation class
- no execution of later steps after failure
- partial-failure report contents
- concurrent apply rejection or serialization
- retry and idempotency behavior for GitHub mutations

### OpenTUI characterization tests

Use OpenTUI's in-process test renderer for stable UI behavior:

- startup and repository error screens
- command palette navigation and execution
- modal submit and cancel
- focus transitions
- command-log failures and details
- persistent notices
- fatal crash presentation
- normal and narrow terminal sizes

Prefer behavior assertions and use golden frames sparingly.

### Terminal smoke tests

Use Terminal Control for a small real-terminal suite:

- launch in a prepared repository
- wait for the main screen
- navigate a panel or modal
- resize
- quit
- verify terminal restoration

Do not make real terminal tests the primary UI test layer.

## Migration Plan

### Phase 0: Baseline and decisions

- adopt this design and resolve its open questions
- capture current command-result and visibility behavior
- add representative parser fixtures
- add production executor characterization tests
- add stack partial-failure ordering tests
- add initial OpenTUI startup/error characterization tests
- add one Terminal Control launch-and-quit smoke test

Exit criteria:

- process semantics and migration boundaries are agreed
- the highest-risk existing behavior has a safety net

### Phase 1: AppProcess walking skeleton

- define process command, result, and typed errors
- implement live Bun and fake layers
- implement scoped cleanup, capture, streaming, timeout, and interruption
- define operation events and the legacy observer adapter
- create the owned `ManagedRuntime` and shutdown path
- migrate one representative operation end to end

The preferred first operation is `jj git fetch`. It exercises a user-visible,
network-duration command, streaming output, non-zero exits, diagnostics,
cancellation, runtime ownership, and compatibility without stack mutation
complexity.

Exit criteria:

- `jj git fetch` uses `AppProcess` through `Jj`
- its existing Promise-facing behavior and command-log behavior remain compatible
- cancellation and shutdown reap the child
- exactly one command-log entry is produced

### Phase 2: Commander consolidation

- make captured jj execution delegate to `AppProcess`
- migrate gh and git process helpers
- migrate hook execution while retaining an explicit shell capability
- preserve successful stderr
- replace callback streaming internals with scoped Effect programs
- keep temporary Promise adapters for existing Solid consumers

Exit criteria:

- non-interactive captured subprocesses use one lifecycle implementation
- duplicate stream readers and result constructors are removed

### Phase 3: Jj, GitHub, and repository health

- complete Effect-native `Jj` and `GitHub` services
- add fake layers and typed parse/domain errors
- implement `RepositoryHealth`
- emit structured warnings for successful jj commands
- expose diagnostics to the existing command log and diagnostics file

Exit criteria:

- service failures no longer disappear into empty values
- repository warnings are available as structured data
- stack preparation can depend on services rather than commander Promises

### Phase 4: Stack preparation and apply

- keep planners pure
- migrate preparation to service dependencies
- add stale-plan validation
- implement incremental durable journaling
- migrate apply to typed Effect workflows
- return structured apply reports
- remove direct `Effect.runPromise` calls from panels

Exit criteria:

- stack tests use layers rather than commander module mocks
- partial mutation failures retain recovery evidence
- interruption propagates through the entire apply scope

### Phase 5: Diagnostics UX companion slice

Implement the companion
[`diagnostics-and-notices.md`](./diagnostics-and-notices.md) specification:

- add the central notice model and bounded history
- map operation warnings and typed failures to notices
- add persistent warning/error presentation and details
- add repository-health and unsnapshotted-file presentation
- add the root error boundary and application-owned crash screen
- disable automatic OpenTUI console behavior in release operation
- add safe keyboard and background-task exception boundaries

This phase can begin earlier once Phase 1 stabilizes the event and error shapes.
It is listed separately because its UI design should not block backend migration.

Exit criteria:

- important warnings and recoverable failures are visible in Kajji-owned UI
- unexpected runtime failures have a Kajji-owned reporting path

### Phase 6: UI cohesion

- centralize command resolution for dispatch, status, and palette
- revise command-palette UX on that shared model
- introduce structured focus transitions
- separate refresh coordination from log/bookmark/diff stores
- move global operation handlers out of `App.tsx`
- split large panels by capability and ownership

This remains a Solid/OpenTUI architecture track. It consumes the application
client but does not move UI state into Effect.

### Phase 7: Legacy removal

- remove the mutable global observer
- remove migrated direct `Bun.spawn` and Bun shell paths
- remove callback stream adapters
- remove scattered runtime execution
- remove obsolete `success`-boolean result types inside Effect code
- remove compatibility adapters after their consumers migrate

Exit criteria:

- one process lifecycle model
- one explicit runtime boundary
- one operation event model
- no Effect-shaped Promise workflows in migrated subsystems

## Review Gates

Each phase should be independently reviewable and should not require accepting
the entire roadmap at once.

For implementation phases, require:

- focused unit and contract tests
- `bun test`
- `bun check`
- changed files passing Biome
- no loss of existing command output or error visibility
- no duplicate command-log entries
- no new unscoped long-running process
- no new direct `Effect.runPromise` in UI components

Effect beta upgrades are separate changes and require the complete architecture
test suite.

## Open Questions

These should be resolved before or during the Phase 1 spike:

1. Should captured output retain the beginning, the end, or both when truncated?
2. Should `runChecked` live on `AppProcess`, or should domain services own all
   non-zero-exit interpretation?
3. Does the first event implementation need a queue, or is an explicit
   infallible sink sufficient until there are multiple consumers?
4. What termination grace period is appropriate for Bun child processes, and
   how should process groups be handled on macOS and Linux?
5. Which command arguments require redaction beyond stdin and environment data?
6. Should interactive child processes be part of `AppProcess` initially or a
   separate follow-up capability?
7. How should CLI invocations share layer construction without creating a
   long-lived global runtime?
8. Which current warnings qualify for persistent notices versus command-log-only
   details?

The Phase 1 walking skeleton should answer these with working code and tests
rather than expanding the abstraction spec further.
