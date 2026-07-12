# Repository and Application Diagnostics

## Status

**Draft / work in progress.** This document is an exploratory product and UI
proposal. It has not been approved as Kajji's final diagnostics design, and none
of its models, policies, presentation choices, sequencing, or implementation
decisions should be treated as settled. Future work should validate its
assumptions and explicitly resolve its open questions before relying on it as an
implementation specification.

Proposed companion specification to
[`effect-migration.md`](./effect-migration.md). This document owns the product
semantics and Solid/OpenTUI presentation of warnings, recoverable failures, and
unexpected crashes. The Effect migration owns the process and domain-service
infrastructure that supplies structured evidence.

The work can ship incrementally. It must not wait for every commander helper to
migrate to Effect, and the Effect migration must not redesign the TUI merely to
support this feature.

## Problem

Kajji captures important information without consistently presenting it to the
user.

Observed examples include:

- a successful jj command warns that oversized files were refused during the
  working-copy snapshot, but Kajji discards successful stderr
- refused files do not appear in normal working-copy diffs because jj did not
  snapshot them
- a jj bookmark read fails because SSH signing cannot find a private key, but
  the useful failure is only visible in OpenTUI's console
- an unexpected keypress-handler stack overflow is caught and logged by
  OpenTUI, bypassing Kajji-owned UI
- ordinary `console.error` output can be captured by OpenTUI while remaining
  inaccessible in a release build

These are different failure classes, but they share one product problem:
Kajji does not provide a durable, understandable, actionable account of
important repository and application conditions.

## Goals

- Surface important repository and application diagnostics in Kajji-owned UI.
- Distinguish information, warnings, recoverable errors, and fatal failures.
- Preserve complete bounded details while presenting concise summaries.
- Keep persistent conditions visible until they are resolved or acknowledged.
- Deduplicate diagnostics produced repeatedly by polling and refreshes.
- Provide safe actions such as viewing details, copying evidence, opening a
  relevant file, or retrying an operation.
- Show refused or otherwise unsnapshotted paths without representing them as
  normal jj working-copy changes.
- Give unexpected runtime failures a Kajji-owned crash screen.
- Write diagnostics directly to the diagnostics file without depending on
  `console.error` interception.
- Preserve the OpenTUI console as a development tool rather than user-facing
  error UI.

## Non-goals

- Treating all stderr as a failure.
- Showing every internal command in the command log.
- Automatically applying potentially dangerous remediation, such as raising
  `snapshot.max-new-file-size`.
- Recovering from every uncaught exception and continuing as if application
  state were trustworthy.
- Replacing the command log; notices and command history serve different uses.
- Moving Solid notice state, modals, key handling, or rendering into Effect.
- Building a general event-sourcing platform.
- Parsing all human-readable `jj status` output into a stable repository model.

## Diagnostic Classes

### Informational

A relevant fact that does not require attention. It is normally transient and
may be retained in history.

Examples:

- an update is available
- a debug snapshot was written
- a recoverable operation completed with a noteworthy result

### Warning

An operation succeeded or the application remains usable, but the user should
review a condition. Warnings may be persistent when the underlying condition
remains true.

Examples:

- jj refused to snapshot oversized files
- configuration is deprecated or partially ignored
- an optional integration is unavailable

### Recoverable error

An operation failed, but Kajji can continue safely.

Examples:

- bookmark loading failed because signing or authentication failed
- fetch or push failed
- an update command failed
- a background refresh failed while previously loaded data remains available

### Fatal failure

Kajji encountered an unexpected defect or invariant failure and should not
pretend normal operation is safe.

Examples:

- an unexpected render or reactive computation failure
- a stack overflow in application event handling
- an uncaught exception that leaves application state uncertain

Fatal presentation may offer restart, report, and quit. Retry is only offered
where a clearly safe recovery boundary exists.

## Data Flow and Ownership

Domain services emit diagnostic facts, not user-facing copy or presentation
policy. The normal path is:

```text
Effect or domain outcome
    -> AppDiagnostic
    -> notice policy mapper
    -> AppNotice
    -> NoticeRecord
    -> Solid presentation
```

Unexpected defects branch before the normal notice store:

```text
Runtime defect
    -> redact and bound evidence
    -> DiagnosticsWriter
    -> minimal CrashState
    -> crash screen
```

### Diagnostic facts

`AppDiagnostic` is a domain-neutral envelope around typed facts. Concrete facts
remain discriminated types such as `RefusedSnapshotDiagnostic`,
`CommandFailureDiagnostic`, or `ConfigurationDiagnostic`.

```ts
export interface AppDiagnostic<TFact = unknown> {
    kind: string
    source: "jj" | "github" | "config" | "update" | "runtime" | "kajji"
    fact: TFact
    evidence?: DiagnosticEvidence
    repositoryPath?: string
    operationId?: string
    observedAt: Date
}
```

Services may provide semantic classification and facts, but must not choose
notice wording, persistence, interruption behavior, or UI actions. A policy
mapper converts eligible diagnostics into notices. Some diagnostics are written
to durable evidence only and never become notices.

`DiagnosticEvidence` must already be bounded and redacted before it crosses
into operation events, diagnostics writing, notice storage, or crash state.
Parsers may inspect raw process output internally, but unsanitized evidence must
not escape that boundary.

### Presentation model

```ts
export type NoticeSeverity = "info" | "warning" | "error"

export interface AppNotice {
    id: string
    severity: NoticeSeverity
    title: string
    message: string
    details?: string
    fingerprint: string
    persistent: boolean
    repositoryPath?: string
    operationId?: string
    actions: readonly NoticeAction[]
}

export interface NoticeRecord {
    notice: AppNotice
    state:
        | "active-unread"
        | "active-acknowledged"
        | "dismissed"
        | "resolved"
    firstSeenAt: Date
    lastSeenAt: Date
    occurrenceCount: number
    dismissedAt?: Date
    resolvedAt?: Date
}
```

Fatal failures are deliberately absent from `NoticeSeverity`; they use the
isolated crash path.

### Stable actions

Retained notices must not hold component closures. Actions are serializable
semantic descriptors, for example:

```ts
type NoticeAction =
    | { type: "view-details" }
    | { type: "copy-details" }
    | { type: "retry-operation"; operation: RetryableOperation }
    | { type: "open-file"; path: string }
    | { type: "copy-command"; command: string }
    | { type: "acknowledge" }
    | { type: "dismiss" }
```

Action execution must revalidate repository identity, path safety, operation
freshness, and current capability. Stored actions are suggestions, not
authorization to replay stale work.

## Diagnostics Writer

There is one low-level `DiagnosticsWriter` capability. It accepts sanitized,
bounded evidence and appends it to Kajji's diagnostics file without depending
on Solid, the notice store, `console.error`, or the Effect runtime remaining
healthy.

Effect services, the notice reporter, and the runtime crash boundary may all
call this capability. The notice store is not the exclusive route to durable
logging. Writer failure is best-effort and must not mask the original outcome
or recursively report through itself.

## Notice Store and Reporting Boundary

The notice reporter accepts non-fatal `AppDiagnostic` values, applies notice
policy, and updates an in-memory store. It should:

- assign a stable fingerprint
- merge repeated occurrences
- update first-seen, last-seen, and occurrence count
- retain a bounded in-memory history
- notify Solid subscribers without using `console.error`
- remain safe if reporting itself fails

Notice history is not persisted initially. The diagnostics file is durable
evidence, while active repository-health conditions are re-derived on startup.
This avoids stale authoritative notices and notice-schema migration work.

Notices are scoped to the repository path where relevant. Switching
repositories must not present an old repository warning as if it belonged to
the new repository, though in-memory history may retain it with its original
path.

## Deduplication and Lifecycle

Polling may observe the same condition every few seconds. A repeated diagnostic
must update one notice rather than create notification spam.

A fingerprint should be based on stable semantic fields, for example:

```text
source + diagnostic kind + repository path + affected paths
```

Do not fingerprint volatile stack lines, timestamps, operation IDs, or complete
human-readable output when a stable structured identity exists.

Lifecycle policy depends on the notice class:

- transient information expires from active presentation and remains in bounded
  in-memory history until evicted
- one-time recoverable operation failures may become `dismissed` and remain in
  history with `dismissedAt`; dismissal ends their active lifecycle
- active repository conditions may be acknowledged, but acknowledgment only
  changes `active-unread` to `active-acknowledged`
- a repository condition becomes `resolved` only when a completed authoritative
  health check no longer reports it
- resolved records remain in bounded history with `resolvedAt`
- a materially changed acknowledged condition becomes unread again

Dismissal and acknowledgment never imply that an active repository condition
has been resolved.

## Presentation

### First-occurrence notification

A new warning or recoverable error should receive a concise, visible
notification. It must not rely on the existing two-second, single-line status
message for important conditions.

The notification should include:

- severity
- short title
- one-line or short wrapped explanation
- an obvious details action
- occurrence count when repeated

### Persistent indicator and history

After the initial notification, unresolved or unread notices remain visible
through an indicator in the normal UI. Opening it shows bounded notice history
and active repository conditions.

The indicator should distinguish at least warnings from errors and should not
consume substantial status-bar space when empty.

### Details view

The details view contains:

- concise summary
- complete bounded command stderr or stack evidence
- source and operation context
- repository path
- occurrence count and timestamps
- safe actions
- diagnostics log path when useful

ANSI control sequences must be stripped or rendered safely. Redaction before
storage is a hard invariant: notice details, diagnostics files, operation
events, crash state, and copied reports receive already-sanitized evidence.
Copying must not be the first point where sensitive command arguments, stdin,
environment values, paths, or credentials are filtered.

### Fatal crash screen

Add a crash component separate from the existing jj-specific `ErrorScreen`.
The existing screen parses known jj failures and offers domain remediation; it
is not a general defect boundary.

The crash screen is driven by a separate minimal `CrashState` owned above the
normal provider tree. Updating it must not require notice history, theme,
command registry, ordinary dialogs, or any provider that may have failed. The
same sanitized report may be written through `DiagnosticsWriter`, but fatal
failures must not update the normal notice store.

The crash screen should use a minimal fallback palette and minimal dependencies
so it can render when a normal provider or theme fails. It should include:

- a clear statement that Kajji encountered an unexpected failure
- error message
- scrollable stack or diagnostic details
- Kajji, Bun, platform, terminal, and repository information
- copy report
- restart when supported safely
- quit

## Repository Health

### Startup recovery

Repository discovery must classify recoverable working-copy failures before
mounting the normal application and starting parallel data loaders. In
particular, jj reports both stale operation ancestry ("The working copy is
stale") and missing or unreadable operation metadata ("Could not read working
copy's operation") as conditions repaired by `jj workspace update-stale`.
These messages should map to one semantic repository-health condition and one
safe recovery action rather than leaking from log, bookmark, or file loading
into the OpenTUI console.

Startup recovery state must also participate in Solid reactivity. Successfully
repairing the repository should replace the recovery screen with the normal
application in the same process; retry counters and loading state belong only
to attempts that leave the condition unresolved.

### Dedicated check

Add a repository-health workflow over the Jj service. Initially it should run
and interpret:

```sh
jj status --color never
```

Run it at controlled synchronization points:

- startup after repository discovery
- after mutations and full refreshes
- after a meaningful externally detected repository change
- on terminal refocus when refresh logic determines a check is needed

The refresh coordinator is the only scheduling authority. Loaders and panels
must not independently run `jj status`, and concurrent or immediately redundant
health checks must be coalesced.

Do not add an independent tight poll that repeatedly snapshots the working copy.
Operation ID and working-copy commit ID may help suppress redundant checks, but
they cannot be the sole key: refused paths never enter the snapshot, so adding
or removing one may leave both IDs unchanged. Controlled refocus or elapsed-time
checks are still required to discover such filesystem-only changes.

The workflow parses raw stdout and stderr internally, then returns structured
known diagnostics with bounded, sanitized evidence. Parsing of human-readable
status output must be narrow, defensive, and fixture-tested.

### Successful stderr

A zero exit code does not make stderr irrelevant. Domain services should retain
successful stderr and classify known warning blocks.

Internal read commands may use `--quiet` where appropriate to suppress routine
non-primary output while preserving warnings and errors. Unknown successful
stderr should at minimum remain in diagnostics; whether it becomes a visible
notice depends on explicit policy.

Do not globally treat every successful stderr byte as a persistent warning.
Some tools use stderr for progress. Classification belongs to the domain
service or command policy.

### Refused snapshots

The initial structured repository-health diagnostic is a refused snapshot:

```ts
interface RefusedSnapshotFact {
    kind: "refused-snapshot"
    paths: Array<{
        path: string
        sizeBytes?: number
    }>
    maxSizeBytes?: number
}

type RefusedSnapshotDiagnostic = AppDiagnostic<RefusedSnapshotFact>
```

A concise notice might read:

```text
2 files were not added to the working copy
They exceed Jujutsu's 1 MiB snapshot limit.
```

The details view should explain that the files exist in the repository working
directory but are absent from the snapshotted working-copy commit.

Safe actions may include:

- copy affected paths
- open `.gitignore`
- copy JJ's suggested configuration command
- copy complete details

Kajji must not automatically ignore files, delete files, or raise the snapshot
limit.

### Working-copy presentation

Unsnapshotted paths should be visible near working-copy changes but in a
separate section:

```text
Working copy files
  M src/App.tsx
  M src/utils/update.ts

Not snapshotted
  ! server.heapsnapshot  125.0 MiB
  ! tui.heapsnapshot      58.1 MiB
```

They must not be inserted into `FileChange[]` as ordinary added or modified
files. They are filesystem paths that jj explicitly excluded from the snapshot.
Diff, restore, split, and commit actions that require a jj tree entry must not
be offered for them.

## Command Failure Policy

Command failure does not automatically imply a notice. The notice policy mapper
uses operation intent and user impact:

- a user-triggered operation that fails to perform requested work normally
  produces a recoverable error notice
- a background failure produces a notice when visible data becomes unavailable,
  stale, incomplete, or potentially misleading
- an expected probe, optional capability check, cancelled operation, or benign
  fallback is diagnostics-only unless it changes user-visible correctness
- repeated failures from one background condition merge into one notice

Eligible failures are translated at the application boundary with structured
evidence such as semantic command name, safe display command, exit code,
bounded sanitized stdout and stderr, repository path, operation ID, and typed
domain classification.

A command can appear in both the command log and notices without being executed
or recorded twice. The command log is chronological operational evidence; the
notice is an attention and recovery mechanism.

Internal read failures that are intentionally absent from the visible command
log still require a notice when they make visible data stale, unavailable, or
misleading, or affect repository safety.

## Unexpected Runtime Failures

No single JavaScript boundary catches every failure. Every unexpected defect is
sanitized and written directly through `DiagnosticsWriter`, then routed to the
minimal `CrashState`; it bypasses the normal notice policy and store.

Use layered capture:

1. A root Solid `ErrorBoundary` for descendant render and reactive failures.
2. Safe command dispatch that catches synchronous throws and rejected command
   promises.
3. A `useSafeKeyboard` wrapper for application-owned direct keyboard handlers.
4. Safe wrappers for owned background tasks, timer callbacks, and fire-and-forget
   promises.
5. Process-level uncaught-exception and unhandled-rejection diagnostics.
6. The Effect runtime defect boundary for Effect causes and defects.

OpenTUI catches and logs exceptions from global keypress handlers internally.
Those errors may not reach a Solid boundary or process handler. Application
keyboard callbacks therefore need to catch and report before OpenTUI swallows
the exception.

Continue to fix the underlying defects and add regression tests. Better crash
reporting is not a substitute for correcting the RevisionPicker reactive scroll
loop or similar failures.

## OpenTUI Console Policy

Pass `openConsoleOnError: false` explicitly when creating the renderer. Do not
rely on OpenTUI version-specific or environment-specific defaults.

The built-in console remains available through a development-only command. It
is not a production error screen and must not be the only location of useful
failure evidence.

Kajji diagnostics must not rely on wrapping `console.error`. OpenTUI replaces
the global console during renderer initialization, and library code can log and
swallow an error without passing through Kajji's original wrapper.

## Effect Boundary

The backend portion is implemented according to
[`effect-migration.md`](./effect-migration.md):

- `AppProcess` owns process lifecycle, concurrent stream draining, timeout,
  interruption, and bounded output
- `Jj` owns jj command construction and command-specific interpretation
- `RepositoryHealth` owns health checks and structured warning parsing
- operation events provide correlation and command evidence
- the application client translates typed outcomes into `AppDiagnostic` facts
- the notice policy mapper translates eligible diagnostics into UI notices
- the runtime defect boundary writes diagnostics and updates isolated crash
  state without entering the notice store

Warnings are successful result data, not Effect failures merely because they
came from stderr. Unexpected Effect defects retain their causes and are
translated at the runtime edge.

The following remain ordinary Solid/OpenTUI concerns:

- notice state and unread counts
- notification and history rendering
- details modals
- crash presentation
- root ErrorBoundary
- safe keyboard wrappers
- local recovery interaction

## Compatibility and Rollout

The diagnostics UX should work with both legacy commander results and new
Effect services during migration.

Introduce one translation boundary for legacy `ExecuteResult` values so that:

- current failures become notices without waiting for full service migration
- successful stderr can be surfaced for selected JJ reads
- operation events do not duplicate command-log entries
- migrated commands and legacy commands produce equivalent user visibility

New Effect services become the source of truth as each command migrates. Remove
legacy adapters after their consumers move.

## Test Strategy

### Pure parser and policy tests

Use captured fixtures for:

- refused snapshot warnings with one and multiple paths
- sizes and limits in different units
- warnings with and without hints
- unknown successful stderr
- malformed or changed human-readable output
- ANSI-colored output
- duplicate fingerprints
- resolution after a clean health result

### Policy and notice-store tests

Cover:

- diagnostic facts that map to notices and diagnostics-only facts that do not
- user-triggered versus background command-failure policy
- first occurrence
- repeated occurrence count
- material change reopening an acknowledged notice
- repository scoping
- bounded in-memory history
- acknowledgement, dismissal, and authoritative resolution
- dismissed and resolved record retention until bounded eviction
- action serialization without retained component closures
- stale action revalidation
- reporting and diagnostics-writer failure isolation

### Service tests

Use fake Effect layers for `AppProcess`, `Jj`, and `RepositoryHealth` to cover:

- successful status with no warning
- successful status with refused paths
- non-zero status failure
- interrupted health check
- bounded/truncated evidence
- redaction

### OpenTUI tests

Use the in-process test renderer for:

- first warning notification
- unread indicator
- details and copy actions
- narrow terminal layout
- unsnapshotted-file section
- root crash fallback above a failing normal provider tree
- fatal failures bypassing the notice store
- keyboard-handler reporting
- dismissal, acknowledgement, and resolution

### Terminal smoke tests

Use a prepared repository containing an oversized untracked file to verify:

- startup warning appears
- details identify the path and reason
- warning remains discoverable after acknowledgement
- resolving the condition clears the active notice
- terminal cleanup remains correct after crash-screen quit

## Delivery Plan

### Phase 1: Characterize and define

- capture fixtures from current JJ warnings and command failures
- define `AppDiagnostic`, `AppNotice`, `NoticeRecord`, stable action, evidence,
  and fingerprint types
- define command-failure notice policy and lifecycle semantics
- define the redaction boundary
- characterize current OpenTUI console behavior
- test current successful-stderr loss and command-failure visibility

Exit criteria:

- severity and persistence policy is agreed
- representative current behavior has regression coverage

### Phase 2: Diagnostic and notice foundation

- add the independent low-level `DiagnosticsWriter`
- add diagnostic-to-notice policy mapping
- add the non-fatal reporter and bounded in-memory notice store
- add deduplication, acknowledgement, dismissal, and resolution
- add a legacy command-result translator
- keep presentation minimal initially

Exit criteria:

- sanitized diagnostic facts can be recorded without Solid or the notice store
- notices can be produced safely from non-UI code
- repeated polling diagnostics do not spam history

### Phase 3: Recoverable presentation

- add warning/error notification UI
- add persistent unread/active indicator
- add notice history and details
- route selected existing command failures through the reporter
- disable automatic OpenTUI console opening

Exit criteria:

- important recoverable failures are visible without opening the debug console

### Phase 4: Repository health

- implement the `RepositoryHealth` workflow through the Jj service
- parse refused snapshot diagnostics
- make the refresh coordinator the sole scheduling authority
- coalesce concurrent checks without relying solely on jj operation IDs
- add unsnapshotted paths to working-copy presentation
- add safe details actions

This phase should use the Effect infrastructure when available, but a temporary
Promise adapter is acceptable at the Solid boundary.

Exit criteria:

- refused paths are visible and remain discoverable until resolved
- repeated refreshes produce one evolving notice

### Phase 5: Runtime crash ownership

- add isolated minimal `CrashState` above the normal provider tree
- add the root Solid ErrorBoundary
- add the Kajji crash screen with minimal dependencies
- add safe command, keyboard, background-task, and timer boundaries
- route process-level and Effect defects directly through redaction,
  `DiagnosticsWriter`, and `CrashState`
- verify fatal failures never update the notice store
- add regression coverage for the RevisionPicker failure class

Exit criteria:

- unexpected application failures have a Kajji-owned reporting path
- release users are not sent to OpenTUI's debug console

### Phase 6: Consolidate

- migrate remaining command-result translations to typed service outcomes
- remove obsolete console interception assumptions
- review notice policy for configuration, update, GitHub, and hook diagnostics
- remove compatibility adapters after commander migration

## Open Questions

1. Where should the active notice indicator live in narrow layouts?
2. Which successful JJ stderr patterns deserve persistent presentation beyond
   refused snapshots?
3. Should an acknowledged repository warning re-notify after a time interval,
   or only after a material change?
4. What is the safest restart mechanism for compiled Kajji after a fatal
   failure?
5. Should opening `.gitignore` use the configured editor suspension flow or an
   in-TUI edit action?
6. How much sanitized evidence should be included in copied reports by default?
7. Which paths or command arguments require additional redaction?
8. What controlled interval or focus policy discovers filesystem-only health
   changes without causing excessive working-copy snapshots?
