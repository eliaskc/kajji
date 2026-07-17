# Effect Post-Migration Review

This document tracks optional work after the completed
[Effect v4 migration](./effect-migration.md). The migration record explains the
ownership model and rollout; this document is a review backlog, not another
migration phase or a requirement to reorganize working code.

## Current Assessment

The architecture has reached the intended boundary:

- `AppProcess` owns captured subprocess lifecycle.
- `InteractiveProcess` separately owns inherited-stdio lifecycle.
- Domain services own command construction, exit policy, parsing, and typed
  failures.
- `ApplicationClient` owns the runtime and presents Promises and structural
  values to the TUI and CLI.
- Solid owns no Effect runtime, environment, fiber, or scope.
- Pure parsers, planners, templates, and models remain ordinary modules.

The remaining direct editor and clipboard subprocesses are explicit local OS
integrations, not leaked repository-domain execution. No extraction below is
urgent merely because a file is long.

## Implementation Update — 2026-07-17 22:02:54 CEST

Typed Effect failures now use `Schema.TaggedErrorClass` throughout the process,
command, hook, GitHub, and stack services. Shared structural payloads such as
`ProcessResult` are schemas as well as TypeScript interfaces, while process
failures retain a schema-backed diagnostic projection of each command instead
of embedding runtime output callbacks in their error values. This keeps
`catchTag`, yieldable-error, and existing message behavior while adding explicit
construction, encoding, and decoding contracts.

The same pass hardened the two untrusted data boundaries identified during the
post-migration review. Successful but malformed gh repository, GraphQL, and
comment responses now fail as `GitHubDecodeError` rather than defects. Persisted
stack state is fully schema-decoded; only a missing state file means empty state,
while malformed or unreadable state reaches the typed `StackStoreError` channel.
Stack state and journals now share durable temporary-file replacement with file
and directory synchronization.

Focused tests cover typed gh decode failures across repository, GraphQL, and
comment responses, error schema round trips, missing versus corrupt stack state,
and durable state replacement. `bun test` reports 331 passing tests, and
typecheck and changed-file Biome checks pass.

An Effect `Stream` prototype remains a separate follow-up. It should prove one
complete process-to-`ApplicationClient` bookmark path before replacing the
current callback-backed streaming implementation.

## Review `src/commander/jj.ts`

`jj.ts` is large because it currently contains four related things: public
operation contracts, typed jj failures, shared execution policy, and the live
implementation of every captured jj capability. That concentration was useful
during migration: one service made lifecycle and exit semantics visible and
prevented premature sub-services.

The best reason to split it later would be change locality, not line count.
Watch for repeated conflicts, unrelated reviewers touching the same file, or
pure command logic becoming difficult to test without reading the Effect layer.

### Good extraction candidates

1. **Pure command arguments and output projections.** A module such as
   `src/commander/jj-command.ts` could own stable templates, argument builders,
   and parsers. Existing examples include `makeGitFetchArgs`,
   `makeGitPushArgs`, diff-target arguments, revision-summary parsing,
   description parsing, commit-details parsing, and nearest-ancestor bookmark
   parsing. The bookmark, file, and log modules already demonstrate the desired
   pattern: execution stays in `Jj`, while templates and parsing stay pure.
2. **Shared ANSI handling.** `jj.ts`, `log.ts`, `bookmarks.ts`, `op-log.ts`,
   `sync.tsx`, and `LogPanel.tsx` contain local stripping logic even though
   `src/utils/ansi.ts` already exports `stripAnsi`. Consolidating those copies is
   a small, independently testable cleanup.
3. **Contracts versus live implementation.** If imports or navigation become
   painful, move operation options, service types, result types, and typed
   failures into a dependency-light `jj-types.ts`, leaving `jj.ts` as the live
   layer. Do this only if it produces a clean dependency direction; splitting a
   1,200-line file into mutually importing files would be worse.

### What should stay in `Jj`

Keep `runRaw`, sink notification, jj environment policy, lifecycle-error
translation, non-zero exit interpretation, stale-working-copy policy, and
composition with `Hooks` together. These are the service's ownership seam.

Do not create one Effect service per jj subcommand. The operations share one
executable, one environment policy, one observer contract, and one failure
vocabulary. Small inline argument arrays are often clearer than a separate
builder used once.

### Suggested extraction test

Extract a pure unit only when it can be described without Effect or process
language, for example:

- “build rebase arguments from mode and target mode”
- “parse a revision-summary projection”
- “split styled commit details from the raw template output”

If the description is “run jj and decide what this exit means,” it belongs in
`Jj`.

## Review `src/application/client.ts`

`ApplicationClient` intentionally has a broad surface: it is the stable
Promise-facing application API. Its size comes from combining the public
contract, layer composition, boundary adapters, and explicit forwarding methods.
That explicitness is valuable because callers can see cancellation, observation,
and structural result policy without knowing Effect.

### Good extraction candidates

1. **Public application contracts.** `src/application/types.ts` could contain
   `ApplicationClient`, public option types, stream handles, and structural
   results. This would let Solid and CLI modules import a dependency-light API
   without loading the runtime composition module.
2. **Observer-to-sink adaptation.** `observerSink` and its error formatting form
   one testable boundary. Extract them if command-log behavior evolves or gains
   another consumer.
3. **Runtime composition.** The layer graph and `ManagedRuntime` construction
   could move to `src/application/runtime.ts` if the factory becomes difficult
   to scan. Keep one composition root and one disposal owner; do not let domain
   adapters create nested runtimes.

### What not to abstract

Avoid a generic service dispatcher that hides whether an operation uses `Jj`,
`GitHub`, `Stack`, `Hooks`, `RepositoryBootstrap`, or `InteractiveJj`. The
current helpers (`runRead`, `runOperation`, `runStack`, and friends) preserve
meaningful differences in failures, sinks, diagnostics, and result adaptation.
A little forwarding boilerplate is preferable to erasing those boundaries.

Likewise, do not generate client methods or expose Effect service methods
directly to Solid solely to reduce file length. The Promise client is an
architectural boundary, not temporary compatibility code.

## Other Follow-Up Candidates

### Effect version upgrade

Kajji pins `effect@4.0.0-beta.98`. Upgrade in an isolated change and inspect the
matching Effect source. Re-run lifecycle, cancellation, timeout, streaming,
stdin, interactive-process, E2E, and benchmark coverage; do not combine the
upgrade with the module extractions above.

### Capture and operation-event policy

Resolve these only when a real caller requires them:

- whether a future bounded capture retains the beginning, end, or both
- which successful warnings deserve persistent notices
- whether operation events need fan-out beyond one explicit sink

The current single-sink design is simpler and correct for current consumers.

### Diff performance

Large-diff scrolling, transient viewport frames, virtualization synchronization,
and resident memory are tracked separately in GitHub issue #132. Streaming the
captured diff would affect first paint and loading memory, not scrolling over
already resident rows, so it is not unfinished Effect migration work.

## Effect CLI Decision

Kajji should keep Citty for now. Replacing it with `effect/unstable/cli` would be
a separate CLI product and output-design change, not migration cleanup.

An isolated `effect@4.0.0-beta.98` spike confirmed that Effect CLI can compose
handlers directly with supplied `Jj` and `AppProcess` layers. It provides typed
flags, structured help and errors, typo suggestions, shell completions, and
straightforward `Command.runWith` testing. Those are real advantages if Kajji's
command tree grows or shared typed command composition becomes valuable.

The current tradeoffs are not compelling enough to switch:

- the API is explicitly unstable
- it adds platform-service, cold-start, memory, and bundle overhead
- built-in completion and log-level flags alter Kajji's compact help surface
- configured defaults are not exposed in `HelpDoc`
- matching current help, version, alias, error, and color behavior would likely
  require a custom `CliOutput.Formatter`

Re-evaluate only with a complete command-tree prototype. Compare existing and
proposed behavior for help, errors, aliases, defaults, JSON output, confirmation,
non-TTY color, completions, startup time, memory, and bundle size. Preserve the
current structural `ApplicationClient` boundary regardless of parser choice.

## Recommended Order

1. Perform the full post-migration review without structural edits.
2. Consolidate duplicated ANSI handling as an independent cleanup.
3. Extract pure jj projections or builders only where tests and change locality
   improve.
4. Split application contracts from runtime composition only if imports or
   navigation are causing friction.
5. Upgrade Effect separately.
6. Revisit Effect CLI only when CLI product requirements justify it.
