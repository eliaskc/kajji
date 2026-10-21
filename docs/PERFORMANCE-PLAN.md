# Performance improvement plan

Status: P01, P03, and P05 are implemented and measured. P02 list virtualization
is retained, but summary virtualization remains open after rejection of the
file-count limit. P03 page-scroll timing remains inconclusive. P04 is implemented
and functionally checked, but final performance acceptance remains open.
P06–P16 remain open.

Investigated on 2026-09-06 against `4faaf28f` (clean working copy).
See [BENCHMARKING.md](BENCHMARKING.md) for measurement rules and
[PERFORMANCE-FINDINGS.md](PERFORMANCE-FINDINGS.md) for earlier observations.
This document is the implementation checklist. Do not create GitHub issues from
it unless requested.

## Goal and order

Make processing, component creation, and rendering depend on visible content
where possible, rather than on all loaded content. Give the current selection
priority over obsolete requests. Keep repeated visits fast without unbounded
memory growth.

The order below is a recommendation based on **expected total benefit in daily
use**, not benefit per unit of implementation effort. It assumes frequent
revision navigation in large repositories. It is not a measured ranking of
completed alternatives. Very large diffs can make P02–P04 more important than
P01. Expensive working-tree scans can make P05 the largest improvement.

**Correctness gate:** fix the dropped-input part of P08 before using pagination
runs to compare performance. Fewer applied inputs must never count as a speed
improvement. This gate can be done before the impact-ranked work below.

## Ordered checklist

Mark an item complete only after its acceptance checks pass. If a proposed
change is rejected after measurement, record that decision instead of marking
an optimization as delivered.

- [x] **P01 — Coordinated, cancellable, cached detail loading**
- [ ] **P02 — Virtualize log, bookmark, file, and summary lists** (summary work remains open)
- [x] **P03 — Remove full-diff work from scroll updates**
- [ ] **P04 — Limit word-diff and wrapped-row preparation to needed content** (performance acceptance remains open)
- [x] **P05 — Coordinate working-copy snapshots and repository reads**
- [ ] **P06 — Reduce first-use syntax cost; compare regex engines**
- [ ] **P07 — Parse and publish bookmark streams incrementally**
- [ ] **P08 — Preserve log movement and improve pagination**
- [ ] **P09 — Target syntax updates and prioritize visible requests**
- [ ] **P10 — Remove quadratic file-tree construction**
- [ ] **P11 — Stream large diffs through a bounded preparation pipeline**
- [ ] **P12 — Reuse diff information when loading the file panel**
- [ ] **P13 — Separate PR metadata loading from bookmark stream updates**
- [ ] **P14 — Measure and reduce work before the first UI frame**
- [ ] **P15 — Bound structural-diff processing**
- [ ] **P16 — Close benchmark and fast-input coverage gaps**

P16 is also a requirement throughout the work: add the relevant regression test
with each change, rather than waiting until the end.

## Evidence and limits

### Live TUI checks

The investigation used Bun 1.4.1 on macOS arm64. These were single diagnostic
runs, not a statistical baseline. They launched the source application through
the benchmark harness, not the installed compiled release. Prepared fixtures
and OS filesystem caches were warm; these were not cold-disk measurements.

| Check | Observation |
| --- | --- |
| Small-fixture log, 80 Down inputs at 16 ms | All 80 inputs were sent and received; selection moved from 0 to 69. Final loaded count was 101. Maximum sender lateness was 1.37 ms. The run failed correctly. |
| Stress-fixture startup | Content ready at 1,580 ms; highlighting ready at 2,330 ms; gap 750 ms. Initial loaded log count was 100, despite an initial limit of 50. |
| Stress-fixture diff, 40 Down inputs at 16 ms | All 40 positions applied; input-to-output p95 was 18.2 ms; maximum position-update gap was 19.7 ms. This short test passed. |

The stress fixture had 300 revisions, 500 local bookmarks with remote entries,
10,000 tracked files, and a tip diff of 12 files × 1,500 lines. Tracked-file count
is not changed-file count. The passing short diff test does not establish
performance across file boundaries or on much larger diffs.

Commands used, for existing prepared fixtures:

```sh
bun bench:tui --fixture .kajji-benchmarks/fixtures/feedback-small \
  --scenarios log --runs 1 --warmups 0 --passes 1 \
  --steps 80 --interval-ms 16 --output /tmp/kajji-perf-audit-log.json

bun bench:tui --fixture .kajji-benchmarks/fixtures/stress \
  --scenarios diff --runs 1 --warmups 0 --passes 1 \
  --steps 40 --interval-ms 16 --output /tmp/kajji-perf-audit-diff.json
```

Use the preparation guide if these local fixtures do not exist. Recreating a
fixture does not reproduce its original operation identity.

### Focused microbenchmarks

These measured isolated functions, not full application response time.
Measurements below are medians after warmup unless stated otherwise. Scripts
and raw reports were temporary files under `/tmp/kajji-perf-audit*`; they are not
a permanent test suite. Rebuild these cases as tests under P16 before relying on
them for future comparisons.

| Case | Observation |
| --- | --- |
| 10,000 synthetic bookmark rows in 16 KiB chunks | Current cumulative parse: 175 ms. Parse only new complete lines: 2.8 ms. Excludes state updates and rendering. |
| Offset work for 100,000 / 500,000 wrapped rows | Hunk offsets, file offsets, and trailing-space calculation: 2.9 / 12.4 ms per call sequence. |
| Deletion-only position lookup, 100,000 / 500,000 rows | 6.9 / 31.8 ms per lookup. The fixture had 1,000 rows per file and no new-side line numbers. |
| One changed-line pair, 500 / 1,000 unrelated words on each side | Word diff: 44.7 / 181.8 ms. This is a difficult input, not a typical source line. |
| Parse and flatten 50,000 / 200,000 added TypeScript lines | 7.0 / 25.9 ms. Excludes wrapping, word differences, components, syntax, and terminal output. |
| Build a tree with 10,000 / 20,000 sibling files | 158 / 580 ms. Flat ordering also built the tree and took 163 / 590 ms. |

### Regex-engine experiment

Shiki performs syntax highlighting. It uses TextMate grammars and a regex engine
to obtain tokens, then applies theme colours. Oniguruma is a candidate **regex
engine within Shiki**, not a replacement syntax highlighter.

A temporary copy of `src/diff/syntax-worker.ts` changed the JavaScript regex
engine to Shiki's Oniguruma/WASM engine. Languages and themes were unchanged.
Each engine was tested with three fresh workers. Each worker processed 100
unique TypeScript lines, then another 100 unique lines after initialization.
The OS cache was not cleared; this was not a randomized full-app A/B test.

| Stage | Current JavaScript engine | Oniguruma candidate |
| --- | --- | --- |
| Worker creation to ready | 92–97 ms | 96–103 ms |
| Ready to first TypeScript token response | 623–636 ms | 28–33 ms |
| Ready to first 100 token responses | 711–724 ms | 35–40 ms |
| Next 100 token responses | 4.8–5.4 ms | 4.2–5.3 ms |

This is a strong first-use lead. It does **not** prove a 600 ms reduction in
whole-app startup, explain all languages, or validate compiled binary support.
No engine change was made in the repository.

## P01 — Coordinated, cancellable, cached detail loading

**Expected benefit:** largest general improvement to repeated revision browsing.

**Finding:** `MainArea` starts textual diff requests without an abort signal.
Selection changes reject old results but do not stop their subprocesses.
`parseDiffString()` runs before the stale-result check. Commit-description and
several file/filter/visual-range reads also use request tokens without cancelling
obsolete work. There is no reusable completed-diff/description cache in these
selection paths. The existing process service already supports interruption.

**Change:**
- [x] Cancel obsolete diff and description requests on selection change and cleanup.
- [x] Check request identity before parsing or publishing results.
- [x] Keep selection immediate; coordinate and bound expensive detail requests.
- [x] Add size-bounded caches and share in-flight reads for repeated targets.
- [x] Use resolved full commit IDs and relevant options as cache keys. Do not use
  change IDs or mutable bookmark names alone. Define refresh/repository-change
  invalidation for symbolic targets and multi-revision selections.
- [x] Apply cancellation to file, filter-preview, and visual-range reads where
  their results are no longer needed. Keep intentional range caching bounded.

**Accept when:** rapid A → B → C navigation does not parse or publish obsolete
results; old children are reaped; revisiting unchanged content avoids repeated
work; changed working-copy/bookmark targets remain correct; memory stays bounded.
Compare first visits and revisits separately, including final detail recovery.

**Start at:** `src/components/panels/MainArea.tsx` (diff fetch effect),
`src/context/sync.tsx` (details, file reads, visual ranges),
`src/components/panels/LogPanel.tsx` (filter previews),
`src/application/client.ts`, `src/process/app-process.ts`.

## P02 — Virtualize log, bookmark, file, and summary lists

**Finding:** the log, operation log, bookmarks, file tree, and diff file-stat
summary create components for all loaded entries. Increasing a display limit is
not virtualization. OpenTUI's viewport culling limits visible render work but
does not remove already-created Solid components and renderables. `AnsiText`
parses its complete input before any `maxLines` limit and can mount all lines.

**Change:**
- [x] Render visible slices with spacers and bounded overscan.
- [x] Use row-height prefix sums for variable-height log/operation-log entries.
  Replace per-selection summation of preceding entry heights.
- [ ] Virtualize large file-stat summaries while keeping every file accessible by
  scrolling in Detail. Do not truncate the list or require a switch to file view.
- [x] Cover the jj-formatter path, not only the custom diff views.
- [x] Preserve unchanged row identity across stream batches and refreshes.
- [x] Cache stable display widths/ANSI parsing where useful. Do not parse or
  recrop every offscreen row on horizontal movement.

**Accept when:** mounted row counts remain proportional to viewport size as
loaded data grows. Test keyboard/mouse movement, resize, horizontal scrolling,
filtering, multi-selection, graph gutters, and file-tree collapse. Measure
component counts, memory, update time, and first visible output.

**Start at:** `src/components/panels/{LogPanel,BookmarksPanel,MainArea}.tsx`,
`src/components/{FileTreeList,AnsiText}.tsx`.

## P03 — Remove full-diff work from scroll updates

**Finding:** both virtualized views combine layout indexing and scroll-position
reporting in one effect. Reading `scrollTop` makes scrolling rebuild hunk offsets,
file offsets, and file offsets again for trailing space. Deletion-only position
lookup can search all rows for a new-side number before trying the old side.

**Change:**
- [x] Memoize layout indexes independently of scroll position.
- [x] Share file offsets with trailing-space calculation.
- [x] Bound position/anchor lookup to the current file; index line locations and
  record whether each side exists.
- [x] Reuse hunk navigation indexes instead of rebuilding flattened hunk lists.

**Accept when:** scroll-only updates do not rebuild layout indexes. Test deleted,
added, binary, empty, and multi-file diffs, split/unified modes, sticky headers,
and anchor restoration. Measure per-update work as total row count increases.

**Start at:** `src/components/diff/Virtualized{Unified,Split}View.tsx`,
`src/diff/virtualization.ts`.

## P04 — Limit word-diff and wrapped-row preparation to needed content

**Status:** implementation and functional checks complete. Repeat performance
comparisons on a quiet machine before final acceptance; see the completion record.

**Finding:** split view computes word differences for every positional
addition/deletion pair before selecting visible rows. Both views allocate an
object for every wrapped display row. Very long lines can make a small number
of source lines produce a large layout and expensive token work.

**Change:**
- [x] Compute and cache word emphasis near the viewport, not for the whole diff.
- [x] Add an explicit work/length limit and whole-line fallback for difficult pairs.
- [x] Store compact wrap counts/prefix sums; construct visible wrapped rows on demand.
- [x] Define long-line limits for tokenization and token slicing as well as word diff.
- [x] Measure fixed overscan of 50 rows on each side before changing it. Keep
  enough overscan for fast wheel/page movement without processing unnecessary content.

**Accept when:** unrelated long lines do not block input; width changes do not
allocate every display row; total height and navigation stay correct. Test
wrapping, no-wrap, tabs, Unicode, split alignment, and structural emphasis.

**Start at:** `src/components/diff/VirtualizedSplitView.tsx` (`buildAlignedRows`),
`src/components/diff/VirtualizedUnifiedView.tsx` (`buildWrappedRows`),
`src/diff/word-diff.ts`.

## P05 — Coordinate working-copy snapshots and repository reads

**Finding:** bootstrap waits for repository checks before rendering. Mount then
starts another refresh-state inspection. Each focused refresh poll runs three
jj commands, including `status`, every two seconds. Many read commands do not
use `--ignore-working-copy`. Actual repeated scan cost remains unmeasured.

**Change:**
- [x] Measure command/snapshot time in a large working tree, both unchanged and
  after external edits. The user's filesystem monitor setting is `none`, which
  matches the test setting; an enabled Watchman comparison was not available.
- [x] Share bootstrap results with initial synchronization.
- [x] Snapshot when needed, then coordinate consistent snapshot-free reads where safe.
- [x] Combine refresh requests; investigate event-driven checks with polling as fallback.
- [x] Preserve stale-workspace detection, Git synchronization, focus refresh, and
  external-change detection. Do not disable snapshots globally.

**Accept when:** startup and idle command/scan counts fall, changes still appear
promptly, and concurrent repository operations do not produce mixed-state views.
Record both application and subprocess cost.

**Start at:** `src/repository-bootstrap.ts`, `src/context/sync.tsx`,
`src/commander/jj.ts` (`refreshState`, `checkWorkingCopy`).

## P06 — Reduce first-use syntax cost; compare regex engines

**Finding:** the isolated experiment above places the major TypeScript delay
inside first token processing, not worker creation alone.

**Change:**
- [ ] Compare Oniguruma with the current JavaScript engine and other maintained,
  Shiki-compatible choices if available. Do not assume arbitrary regex engines
  can execute TextMate grammars correctly.
- [ ] Review upstream archive/maintenance status, known vulnerabilities, and the
  supported Shiki/WASM integration. The archive concern is not automatic rejection,
  but a maintained wrapper does not remove engine maintenance risk.
- [ ] Test first use of representative languages and pathological long lines.
- [ ] Verify token output, themes, error fallback, worker startup, and compiled
  binaries on supported platforms. Measure binary size and memory as well as time.
- [ ] Separately test lazy language/theme loading or targeted warmup if needed.
  The worker currently imports about 30 language modules and both themes.
  Earlier broad warmup did not help; do not restore it without new evidence.

**Accept when:** repeated full-app comparisons show a useful first-highlight
improvement without correctness, packaging, maintenance, or repeated-use regressions.
Record the chosen engine and rejected alternatives. Adoption of Oniguruma is not
pre-decided.

**Result, 2026-10-21:** replaced Shiki in the syntax worker with
`@pierre/highlights` 0.2.0 (hand-written Wasm lexers, no TextMate grammars), not
another Shiki regex engine. Default stress fixture, A→B→A with five measured
processes per scenario: `highlightedReadyOutputMs` fell from 1.61–1.64 s to
0.96–0.98 s (about −40%) in diff, log, and bookmarks, while `contentReadyOutputMs`
was unchanged. Peak RSS fell 8–13%. Line scrolling did not change beyond run
variation. A 300-step diff page scroll halved the first-pass downward
`updateGapMaxMs` (59 → 31 ms median); the warm second pass did not change. The
compiled darwin-arm64 binary highlighted correctly in both themes. Colours come
from Zed's Ayu Dark and GitHub Light themes, so they differ slightly from the
Shiki/VS Code versions. All 30 previously bundled languages are supported.
Oniguruma was not adopted. The package is pinned because it is pre-1.0.

**Follow-up, 2026-10-21:** each hunk side is now tokenized as one block, so
block comments and multi-line strings keep their lexer state. Tokens are returned
as transferable typed arrays and cached per block by content hash. Compared with
per-line Highlights (one B→C run, not A→B→A): `highlightedReadyOutputMs` fell
3–5% and peak RSS fell 10–24% in diff/log scenarios; scrolling did not change
beyond run variation.

**Start at:** `src/diff/syntax-worker.ts`, `src/diff/syntax.ts`, `scripts/build.ts`.

## P07 — Parse and publish bookmark streams incrementally

**Finding:** `streamBookmarks` reparses all complete output on each chunk, then
parses the full output again at completion. This creates new objects for earlier
rows. State updates repeatedly copy/filter lists; refresh merging rebuilds the
previous-entry index each time. Bookmark limits restrict display, not loading.

**Change:**
- [ ] Keep only an incomplete-line buffer; append parsed complete records.
- [ ] Publish on a bounded cadence, with prompt first content and a final flush.
- [ ] Retain stable objects for unchanged entries. Reuse refresh indexes.
- [ ] Memoize local/remote lists, counts, selected-name indexes, and display maps.
- [ ] Avoid replacing the entire visible list when only its tail changes.

**Accept when:** parsing work grows approximately with input bytes, not with the
sum of all prefixes. Test arbitrary chunk boundaries, final lines without a
newline, empty lists, remote-only entries, deletion, and local/remote consistency
mid-refresh. Include refresh costs, not only initial parsing.

**Start at:** `src/commander/jj.ts` (`streamBookmarks`),
`src/commander/bookmarks.ts`, `src/context/sync.tsx`, `src/context/sync-bookmarks.ts`,
`src/components/panels/BookmarksPanel.tsx`.

## P08 — Preserve log movement and improve pagination

**Finding:** normal Down navigation returns while `logLoadingMore()` is true,
even with loaded rows available. The live test lost 11 requested positions.
Prefetch can replace an unfinished initial stream. Each next page reruns the
whole prefix with a limit increased by 50. Operation-log pagination also reloads
a growing prefix. New objects can cause existing rows to be recreated.

**Change:**
- [ ] Keep movement within loaded rows active during loading.
- [ ] Preserve requested movement at a page boundary; handle end-of-history,
  errors, direction changes, and filter changes explicitly.
- [ ] Separate initial stream completion from prefetch state and eligibility.
- [ ] Retain unchanged row objects when updating pages.
- [ ] Investigate incremental paging or a longer-lived stream. If jj graph
  semantics require prefix replacement, document that constraint and measure
  alternatives such as larger/adaptive pages rather than claiming true paging.

**Accept when:** delayed-page tests preserve all intended movement. Test merges,
elided revisions, divergent changes, mutable history, filters, and graph
continuity. Startup must not cancel and restart useful work unnecessarily.
Do not score runs that lose input.

**Start at:** `src/context/sync.tsx` (`loadLog`, `loadMoreLog`),
`src/components/panels/LogPanel.tsx` (`selectNextCommit`, prefetch, operation log),
`src/commander/jj.ts` (`streamLogPage`).

## P09 — Target syntax updates and prioritize visible requests

**Finding:** every token response increments one global signal. All mounted
memos that read it can recompute, including rows whose tokens did not change.
Requests are per line or word-emphasis segment; pending work has no viewport
priority or selection generation. The completed-token cache is bounded, but
that does not bound pending work.

**Change:**
- [ ] Batch token requests/responses and notify only affected content.
- [ ] Prioritize viewport content over overscan and obsolete selections.
- [ ] Bound the pending queue and discard obsolete queued work.
- [ ] Measure full-line tokenization with emphasis applied afterward, rather
  than separate syntax requests for each emphasis fragment.
- [ ] Define ready/error/timeout handling so failed workers do not leave pending
  requests or readiness checks stuck indefinitely.

**Accept when:** completing one token request does not update unrelated rows;
rapid scrolling keeps the queue and memory bounded; visible syntax completes
promptly. Test theme changes, repeated content, worker failure, and revisits.

**Start at:** `src/diff/syntax.ts`, `src/diff/syntax-worker.ts`, both virtualized views.

## P10 — Remove quadratic file-tree construction

**Finding:** every insertion searches `children` by name. Large sibling groups
therefore require quadratic work. Flat path ordering unnecessarily builds,
sorts, compresses, and flattens the tree first.

**Change:**
- [ ] Use child-name indexes during construction, then retain ordered child arrays.
- [ ] Sort paths directly in flat mode, preserving established ordering semantics.
- [ ] Reuse path indexes for file selection and navigation where appropriate.

**Accept when:** large sibling groups no longer show quadratic construction cost;
ordering, directory compression, status, binary flags, and selection remain correct.

**Start at:** `src/utils/file-tree.ts`, `src/context/sync.tsx`,
`src/components/panels/MainArea.tsx` (`orderedFiles`).

## P11 — Stream large diffs through a bounded preparation pipeline

**Finding:** textual diffs are collected as complete strings before parsing.
The process stream has bounded event backpressure, but also retains full stdout.
Parsing, flattening, maximum-width/line-number scans, ordering, and row preparation
run before the relevant content is available. Virtual rendering alone does not
bound those costs or the size of buffered results.

**Change:**
- [ ] Measure stage time and retained bytes before choosing workers versus chunked work.
- [ ] Investigate file/hunk-level streaming, early publication of usable files,
  and worker-based parsing with request-generation checks.
- [ ] Compute shared statistics during preparation instead of repeated full scans.
- [ ] Add an output-retention policy for stream consumers that do not need full
  stdout; preserve required command diagnostics and bounded stderr information.
- [ ] Bound intermediate data and caches by size, not only number of entries.

**Accept when:** large diffs show useful content before all processing finishes,
input remains responsive, and memory does not multiply with obsolete requests.
Test chunk boundaries, binary files, renames, malformed output, process failure,
cancellation, and final counts. Do not publish an incomplete hunk as complete.

**Start at:** `src/process/app-process.ts`, `src/commander/jj.ts` (`readDiff`),
`src/diff/parser.ts`, `src/components/panels/MainArea.tsx`.

## P12 — Reuse diff information when loading the file panel

**Finding:** `jjFiles()` runs a summary command and a complete Git-format diff
in parallel. The second result is used to identify binary files. The detail panel
can already have requested and parsed that same diff. File mode currently loads
the full displayed diff rather than restricting it to the selected path.

**Change:**
- [ ] Share file metadata/binary detection with the matching detail result or cache.
- [ ] Deduplicate in-flight reads for the same resolved target.
- [ ] Evaluate selected-file-first loading for very large changes, without losing
  whole-diff navigation, statistics, or correct binary/rename information.

**Accept when:** entering file mode does not regenerate an available full diff;
metadata stays consistent across refreshes and selection changes.

**Start at:** `src/commander/jj.ts` (`readFiles`), `src/context/sync.tsx`,
`src/components/panels/MainArea.tsx`.

## P13 — Separate PR metadata loading from bookmark stream updates

**Finding:** the metadata effect reads bookmark names on each stream update and
restarts the request. The service resolves the repository and constructs one
GraphQL query for all heads, with two query fields per head. No query-size
batching or reusable metadata cache was found in this path. Network impact was
not measured; the benchmark disables authenticated network work.

**Change:**
- [ ] Trigger from meaningful name-set changes or settled stream batches, not
  every new bookmark object array.
- [ ] Cache repository identity and PR metadata with explicit refresh rules.
- [ ] Bound query size/concurrency; prioritize displayed heads and fetch only
  missing/stale metadata. Keep optional network work off the local-content path.

**Accept when:** local bookmark streaming does not repeatedly restart equivalent
requests; thousands of heads do not create an unbounded query; metadata remains
correct after push, fetch, and PR changes. Test with mocked delayed responses.

**Start at:** `src/context/sync.tsx` (PR metadata effect),
`src/commander/github-service.ts` (`listPullRequestsByHead`).

## P14 — Measure and reduce work before the first UI frame

**Finding/lead:** `tui.tsx` imports the app, terminal integration, startup/mock
screens, and highlighting before inspection/rendering. Panels statically import
many dialogs. Parser/language helpers use the broad `@pierre/diffs` entry point.
The source launch also pays the Solid preload cost. No import-by-import timing
or production-binary comparison was completed, so these are investigation leads,
not proven dominant costs.

**Change:**
- [ ] Measure preload, module evaluation, repository inspection, UI construction,
  first content, and first highlighting separately for source and compiled builds.
- [ ] Defer optional screens/dialogs/integrations where measurements justify it.
- [ ] Investigate supported narrow dependency exports or upstream changes; do not
  depend on unexported internal paths without an explicit compatibility decision.
- [ ] Consider an early UI shell while inspection runs, preserving error/recovery flows.

**Accept when:** first output and useful-content readiness improve in repeated
runs, not merely move the same delay to the first interaction. Keep CLI commands
and supported installation paths working.

**Start at:** `src/index.tsx`, `src/tui.tsx`, `src/App.tsx`, `bin/kajji`,
`src/diff/{parser,syntax}.ts`, `scripts/build.ts`.

## P15 — Bound structural-diff processing

**Finding/lead:** the structural path first obtains the textual diff, materializes
both sides, copies trees, runs directory-mode Difftastic, parses complete JSON,
and reads matching file pairs through `Promise.all`. This can produce large
concurrent reads and retained data. No structural-engine benchmark was run.
It already cancels subprocess work when selection changes; preserve that support.

**Change:**
- [ ] Measure tree materialization/copying, Difftastic, JSON validation, file reads,
  flattening, memory, and cancellation separately.
- [ ] Bound file-read/preparation concurrency and check selection identity during work.
- [ ] Evaluate result reuse, supported file restrictions, and early per-file upgrades.
  Retain textual fallback and rename normalization.

**Accept when:** large structural diffs have bounded intermediate work and prompt
cancellation, with correct fallback, alignment, emphasis, and temporary-file cleanup.

**Start at:** `src/commander/structural-diff.ts`, `src/diff/structural/`,
`src/components/panels/MainArea.tsx` (structural upgrade).

## P16 — Close benchmark and fast-input coverage gaps

- [ ] Add regression tests for obsolete request cancellation and early stale checks.
- [ ] Add delayed-page tests that assert every requested movement, without idle waits.
- [ ] Add full-diff scroll-index, deletion-only lookup, long-line word-diff,
  many-sibling tree, and incremental bookmark parser benchmarks.
- [ ] Repair syntax microbenchmarks: `initHighlighter()` returns before worker
  readiness, and `tokenizeLineSync()` measures immediate fallback/cache access.
  Wait for actual results; test unique content and separate first use from reuse.
- [ ] Measure mounted row counts, pending requests, buffered bytes, and subprocess
  lifetimes so rendering and data-loading costs can be distinguished.
- [ ] Cover file-boundary scrolling, large summaries, remote-only bookmark lists,
  branching history, and split/no-wrap modes.
- [ ] Add structural/jj-formatter, compiled-startup, external-change, and network
  scenarios where relevant. Current textual source-launch tests do not cover them.
- [ ] Retain immediate text-plus-Enter and first-cursor tests. Add immediate-input
  tests for other editors/palette and rapid layout transitions. Earlier intermittent
  failures remain leads, not confirmed common performance causes.
- [ ] Keep screen capture/trace overhead fixed for comparisons. Periodic captures
  can delay the sender. Never treat a failed or lower-work run as a speed gain.

Existing safeguards worth retaining: scoped child-process cancellation, bounded
stream event queues, the bounded completed-token cache, log stream publication
throttling, and separate content/highlighting readiness metrics.

## Completion record

For each item, append a short record here when it is implemented or rejected:

- Item ID and decision.
- Changes made, or reason for rejection/deferral.
- Tests and exact benchmark configuration.
- Before/after startup, tail latency, recovery, completed work, and memory as applicable.
- Regressions checked, remaining limits, and local evidence location.

Use repeated A → B → A runs on the same prepared fixture for performance claims.
Keep private fixtures and reports local. Do not add source content from copied
repositories to these documents. Run relevant unit/E2E checks and type/lint checks
for code changes; do not run them concurrently with timed benchmarks.

### P01 — Implemented, 2026-09-06

**Decision:** retain the change. Detail recovery improves substantially during
rapid revision navigation. Startup is slower in these runs; this is an explicit
trade-off, not a startup improvement.

**Changes:**
- `ApplicationClient` shares in-flight detail reads. At most four reads run at
  once, including process cleanup. At most 32 reads wait; newer queued reads
  start first, and overflow cancels the oldest queued read.
- A consumer can cancel without interrupting other consumers of the same read.
  When the last consumer cancels, the process scope is interrupted. A cancelled
  read cannot parse, publish, or populate the completed cache from a late result.
- Prepared textual diffs and descriptions use a shared LRU cache limited to
  32 MiB of estimated retained data and 128 entries. Oversized results are not
  retained. Prepared diffs reuse parsed and flattened rows, not just command output.
- Keys include repository path, full commit IDs, and read options. Visible
  multi-selection members use full commit IDs. Mutable symbols, change IDs,
  unresolved connectors, and range expressions have no completed-result cache;
  they are read again. Refresh, configuration changes, and repository mutations
  invalidate completed detail reads. Reads from an earlier cache generation
  cannot populate the new cache.
- File and filter reads share active requests but do not retain completed results.
  Completed file-metadata reuse remains P12; binary detection can return degraded
  metadata, which must not become a reusable cached result.
- File, filter-preview, applied-filter, and visual-range requests cancel when
  obsolete or on cleanup. Visual-range caching is limited to 32 entries and
  256 KiB of estimated retained IDs and keys. Its keys include full endpoints,
  loaded-list length, and refresh generation.
- The detail panel refreshes symbolic targets on repository refresh and includes
  formatter width in its request identity. Selection remains immediate.

**Validation:** `bun test` (406 tests), `bun test:e2e` (16 tests), `bun check`,
`bun bench:check`, and `bun lint`. New tests cover A → B → C and A → B → A,
late-result preparation, shared-consumer cancellation, queue limits, cache
size/count eviction, invalidation, mutable targets, read options, failures,
cleanup, and termination/reaping of a real child. Live TUI tests cover rapid
revision changes and external working-copy edits. Existing TUI tests cover
file navigation, resize, description changes, undo, and multi-selection.

**Measurement:** A1 → B1 → A2 → B2 on the same prepared `stress` fixture. A uses
the application source from `4faaf28f`; candidate files were backed up and
restored for A2. Bun 1.4.1, OpenTUI 0.5.10, and Terminal Control 1.2.1 were fixed.
Each group used one excluded warmup and three measured processes. No tests ran
concurrently with these measurements.

```sh
bun bench:tui --fixture .kajji-benchmarks/fixtures/stress \
  --scenarios log --runs 3 --warmups 1 --passes 2 \
  --steps 40 --interval-ms 16 --output /tmp/kajji-p01-GROUP.json
```

Defaults remained 120×36 cells, textual unified diff, wrapping, dark theme, and
endpoint-only screen captures. These runs exclude pagination. Each burst applied
all 40 requested positions, in both directions and both passes.

Per-group medians across the three measured processes:

| Metric | A1 | B1 | A2 | B2 |
| --- | ---: | ---: | ---: | ---: |
| Content ready, ms | 1,077 | 1,142 | 1,102 | 1,187 |
| Highlighted ready, ms | 1,785 | 1,875 | 1,800 | 1,944 |
| First-pass Down input-to-output p95, ms | 29.5 | 25.3 | 29.9 | 25.3 |
| First-pass Down final recovery, ms | 1,840 | 117 | 1,764 | 150 |
| First-pass Up final recovery, ms | 1,898 | 24 | 2,030 | 19 |
| Second-pass Down final recovery, ms | 2,070 | 19 | 2,016 | 21 |
| Second-pass Up final recovery, ms | 1,891 | 20 | 1,453 | 18 |
| Kajji peak RSS, MiB | 731 | 558 | 563 | 526 |
| Kajji plus descendants peak RSS, MiB | 1,782 | 594 | 1,639 | 578 |
| Maximum sampled process count, including Kajji | 69 | 4 | 68 | 5 |

Application-only RSS varied substantially. The repeat supports lower descendant
memory and process accumulation, not a general reduction in Kajji's own memory.
Process counts and RSS are sampled; short-lived children can be missed. Recovery
includes final detail and highlighting completion. First and repeated visits are
reported separately, and no failed or lower-work run is included.

**Limits:** the cache size is an estimate, not a heap limit. Large single results
and process output remain P11. Structural result caching and file-metadata reuse
are not included. The timed workload uses textual source launch and linear
history; it does not establish structural, compiled-startup, network, or
pagination performance. P08's input-correctness prerequisite remains open.
The final candidate also has a structural cleanup guard and no completed file
cache; neither changes this log-only textual workload.

**Local evidence:** `/tmp/kajji-p01-{a1,b1,a2,b2}.json`,
`/tmp/kajji-p01-comparison-final.txt`, `/tmp/kajji-p01-unit.log`, and
`/tmp/kajji-p01-e2e.log`. Reports and fixtures remain local.

### P01 — Effect service refactor, 2026-09-06

**Decision:** retain the Effect implementation. This changes ownership of
concurrency and cancellation, not P01's cache or selection policies.

- `src/application/detail-service.ts` defines the scoped `Details` service.
  It calls `Jj` effects directly. `ApplicationClient` converts results to
  Promises only at the UI boundary; it also maps interruption to `AbortError`.
- `RcMap` shares active reads and tracks consumers through scopes. Closing the
  last consumer scope interrupts the producer. Separate typed readers preserve
  result and error types without casts or a custom in-flight map.
- Four scoped workers consume a `TxPriorityQueue`. Deferred admission and
  completion signals preserve newest-first ordering, the 32-entry queue limit,
  and the requirement to finish child cleanup before reusing a worker slot.
  There are no manual Promise resolvers, abort listeners, consumer counts, or
  running-work counters in the coordinator.
- The byte-weighted completed cache remains explicit application policy. All
  typed readers share the same 32 MiB / 128-entry budget. Native `Cache` does
  not provide byte capacity or the required last-consumer cancellation rule.
  Pinned Effect source and current upstream source were inspected before choosing
  `RcMap`.
- Invalidation is an Effect. Mutation finalizers invalidate within the runtime;
  UI refresh waits for invalidation before starting replacement reads. Closing
  the application runtime closes the service and all its workers and lookups.

**Validation:** `bun test` (408 tests), `bun test:e2e` (16 tests), `bun check`,
`bun bench:check`, and `bun lint`. Coordination tests now use Effect fibers,
scopes, and Deferred signals instead of Promise resolvers or timed waits. Tests
include shared byte/count budgets, a shared worker pool across result types,
typed failures, defects, interruption, queue overflow, late preparation, and
shutdown. Real child termination and the existing TUI tests remain covered.
A formatting-only correction to the existing `skills-lock.json` was needed for
repository-wide lint.

**Measurement:** Promise A1 → Effect B1 → Promise A2, using the P01 Promise
source at `78d429e9` for both A groups. Same `stress` fixture and harness; one
excluded warmup and three measured processes per group. The candidate source
was backed up and restored for A2. Bun on PATH changed to 1.4.2 during the work,
so subsequent comparisons explicitly pinned both controller and target to
Bun 1.4.1. Effect remained 4.0.0-beta.98; OpenTUI and Terminal Control remained
0.5.10 and 1.2.1. No tests ran concurrently with measured benchmarks.

```sh
/Users/elias/.local/share/mise/installs/bun/1.4.1/bin/bun scripts/benchmark.ts run \
  --bun /Users/elias/.local/share/mise/installs/bun/1.4.1/bin/bun \
  --fixture .kajji-benchmarks/fixtures/stress --scenarios log \
  --runs 3 --warmups 1 --passes 2 --steps 40 --interval-ms 16 \
  --output /tmp/kajji-p01-effect-GROUP.json
```

All other settings match the P01 comparison above. Per-group process medians:

| Metric | Promise A1 | Effect B1 | Promise A2 |
| --- | ---: | ---: | ---: |
| Content ready, ms | 1,083 | 1,130 | 1,148 |
| Highlighted ready, ms | 1,786 | 1,817 | 1,829 |
| First-pass Down input-to-output p95, ms | 25.7 | 25.1 | 25.5 |
| First-pass Down final recovery, ms | 125 | 117 | 111 |
| First-pass Up final recovery, ms | 26 | 19 | 21 |
| Second-pass Down final recovery, ms | 17 | 18 | 23 |
| Second-pass Up final recovery, ms | 22 | 22 | 23 |
| Kajji peak RSS, MiB | 594 | 580 | 581 |
| Kajji plus descendants peak RSS, MiB | 656 | 643 | 617 |
| Maximum sampled process count, including Kajji | 5 | 5 | 5 |

Every burst applied all 40 requested positions. The results support preserving
P01's responsiveness, not a separate speed or memory improvement from Effect.
Startup ranges overlap; this comparison does not establish a new startup cost.
The original P01 measurement limits still apply.

**Local evidence:** `/tmp/kajji-p01-effect-{a1,b1,a2}.json`,
`/tmp/kajji-p01-effect-comparison.txt`, `/tmp/kajji-p01-effect-unit.log`, and
`/tmp/kajji-p01-effect-e2e.log`.

### P02 — List virtualization, 2026-09-06

**Decision:** retain the implementation. Native component tests confirm bounded
mounted rows. Repeated TUI comparisons support lower memory use and faster log
and bookmark navigation. They do not establish a general diff-scroll improvement.

**Changes:**
- `VirtualList` uses visible slices, height-preserving spacers, and eight lines
  of overscan on each side. Native scrollbar-change and viewport-resize events
  update the slice; virtualization does not wait for a polling timer.
- Revision, filtered-revision, operation-log, bookmark, and file-tree paths use
  the shared component. Log height indexes are independent of selection. A very
  tall entry also mounts only its visible inner lines. Mouse handlers retain
  absolute list indexes, not indexes within the visible slice.
- Equal rows retain their objects across replacement batches and refreshes.
  The retention map contains only the current collection. Changed graph data
  and metadata replace the affected row. File-tree collapse indicators remain
  reactive when the row object is retained.
- `AnsiText` can mount a visible line slice for the jj-formatter path. Parsed
  ANSI data has a shared LRU cache, limited to 512 entries and an estimated
  2 MiB. Oversized results are not cached. Theme foreground resolution remains
  separate from parsing. Horizontal cropping only affects mounted lines.
- The initial implementation limited summaries with more than 20 files to the
  first eight plus an omitted count and a file-view instruction. This limit was
  rejected and removed on 2026-09-07; see the correction below. The measured
  stress fixture had 20 files or fewer, so the limit did not affect those runs.
- Removed the duplicate parent file-selection scroll effect; the filterable
  file list owns scrolling in both filtered and unfiltered modes.

**Validation:** `bun test` (417 tests), `bun test:e2e` (19 tests), `bun check`,
`bun bench:check`, and `bun lint` pass. The test-specific OpenTUI preload was
added to `bunfig.toml`: without it, Bun tests used Solid's non-reactive server
implementation. The new tests now exercise real reactive components.

Native-renderer checks load 10,000 rows in a 12-line viewport and assert at most
28 mounted rows, including after a jump to row 5,000. They cover wheel scrolling,
mouse selection, resize, list shrinkage, unchanged refreshes, appended rows,
a 10,000-line entry, and large ANSI output with horizontal cropping. Pure tests
cover height indexes up to 100,000 rows, row replacement, ANSI state across
lines, eviction, and oversized-cache rejection. Live TUI tests cover 70 added
history entries, exact revset filtering, operation-log navigation, 100 local and
100 remote-only bookmarks, file filtering, tree collapse/expansion, a 122-file
summary, and jj-formatter scrolling/resizing. Existing graph, multi-selection,
layout, file-navigation, and immediate-input tests remain in place. The new
functional tests use completed-state checks; they are not new claims about
immediate filter dismissal or pagination correctness.

**Measurement:** A1 → B1 → A2 → B2, with source `81d3e830` for both A groups.
A2 ran from a temporary jj workspace with the same dependencies. B2 includes
an additional filtered-row equality correction: each row stores only its group
revset, not the group's full commit array. Both comparisons passed the harness
compatibility checks. Controller and target Bun were fixed at 1.4.2; OpenTUI was
0.5.10, Effect was 4.0.0-rc.112, and Terminal Control was 1.2.1. No tests or builds
ran concurrently with measured benchmarks.

```sh
/Users/elias/.local/share/mise/installs/bun/1.4.2/bin/bun scripts/benchmark.ts run \
  --bun /Users/elias/.local/share/mise/installs/bun/1.4.2/bin/bun \
  --fixture .kajji-benchmarks/fixtures/stress \
  --scenarios log,bookmarks,diff --runs 3 --warmups 1 \
  --passes 2 --steps 20 --interval-ms 16 \
  --output /tmp/kajji-p02-GROUP.json
```

Settings: 120×36 cells, textual unified diff, wrapping, dark theme, endpoint-only
screen capture (`--sample-ms 0`), prepared fixture and warm filesystem caches.
Each group has one excluded warmup and three measured processes per scenario.
The 20-step log workload stays within loaded rows; P08 remains open. Each report
contains 720 measured inputs and 720 applied positions, with no position-update
gap over 100 ms. An initial A1 attempt was rejected for 31.2 ms sender lateness;
the same configuration was repeated before code changes. The failed report is
not included in the comparisons.

Per-group process medians:

| Metric | A1 | B1 | A2 | B2 |
| --- | ---: | ---: | ---: | ---: |
| Log first content observed, ms | 781 | 805 | 899 | 782 |
| Log content ready, ms | 1,148 | 1,073 | 1,262 | 999 |
| Log highlighted ready, ms | 1,823 | 1,788 | 2,014 | 1,706 |
| Bookmark content ready, ms | 1,144 | 1,052 | 1,213 | 1,058 |
| Diff content ready, ms | 1,085 | 1,091 | 1,359 | 1,051 |
| Log first-pass Down input-to-output p95, ms | 24.5 | 16.3 | 23.9 | 17.7 |
| Bookmark first-pass Down input-to-output p95, ms | 19.0 | 16.7 | 20.1 | 16.9 |
| Diff first-pass Down input-to-output p95, ms | 11.1 | 6.9 | 15.6 | 13.8 |
| Log first-pass Down recovery, ms | 105 | 109 | 123 | 105 |
| Log first-pass Up recovery, ms | 22 | 16 | 28 | 14 |
| Log second-pass Down recovery, ms | 22 | 22 | 17 | 10 |
| Log second-pass Up recovery, ms | 20 | 19 | 25 | 11 |
| Bookmark first-pass Down recovery, ms | 16.6 | 7.4 | 14.6 | 6.7 |
| Diff second-pass Up recovery, ms | 12.4 | 15.1 | 8.9 | 5.9 |
| Log Kajji peak RSS, MiB | 483 | 414 | 507 | 427 |
| Bookmark Kajji peak RSS, MiB | 462 | 398 | 437 | 406 |
| Diff Kajji peak RSS, MiB | 458 | 386 | 427 | 401 |

Both B groups reduce log/bookmark first-pass Down p95 and sampled Kajji peak
RSS against both A groups. B2 peak RSS is about 6–16% lower, depending on scenario
and reference group. Startup varied between groups; first observed output did
not consistently improve. Diff timing also varied: B1's slower second-pass Up
recovery did not recur in B2, while B2's first-pass Down p95 was higher than A1.
No broad diff-scroll speed claim is made. B2 log first-pass Down recovery ranged
from 99 to 141 ms; the similar median does not mean every run recovered faster.

**Remaining limits:** loaded arrays, equality checks, and height-index preparation
still scale with loaded content when that content changes. Virtualization bounds
mounted components, not all data preparation. Full jj-formatted ANSI output is
still parsed once before line slicing, to retain terminal state and total line
count; `maxLines` is not a streaming parser limit. Large-output preparation and
long-line policies remain P11/P04. The short timed diff run does not cover file
boundaries or structural/compiled/network performance. Local and remote list
functional checks do not establish network performance. P08's pagination
correctness requirement remains open.

**Local evidence:** `/tmp/kajji-p02-{a1,b1,a2,b2}.json`,
`/tmp/kajji-p02-compare-{a1,a2}-{b1,b2}.txt`, `/tmp/kajji-p02-unit.log`,
`/tmp/kajji-p02-e2e.log`, and `/tmp/kajji-p02-final.diff`. Fixtures and reports
remain local.

### P02 — Reject the Detail file-count limit, 2026-09-07

**Decision:** remove the summary limit introduced in `42cb3be0`. Access through
file view is not a substitute for the complete file list in Detail. Performance
changes must preserve scrolling through all summary files in the same panel.
The other P02 changes remain in place.

**Changes:** `FileStats` renders every file again. Removed the omitted-file message.
Summary virtualization remains open: mounted summary rows currently grow with
file count. Any future implementation must preserve the full scroll range.

**Validation:** the updated large-summary E2E test scrolls Detail to
`row-119.txt` in a 122-file change, then checks bookmark and file-tree navigation.
That focused test, all 446 unit tests, `bun check`, and `bun lint` pass.
No new performance measurements were made; no speed or memory claim is made
for this correction.

### P03 — Indexed diff scroll updates, 2026-09-06

**Decision:** retain the implementation. Native component tests confirm that
scroll-only updates do not rebuild or publish layout indexes. Function tests and
microbenchmarks confirm bounded position queries. Repeated short unified TUI
runs show a small latency reduction. Long page-scroll timing is inconclusive;
this is not a general diff-scroll, startup, or memory improvement claim.

**Changes:**
- Both views memoize a shared `DiffLayoutIndex` from wrapped rows. File/hunk
  offsets, scroll-tail height, current position, and anchor restoration have
  separate effects. Scroll position and viewport height do not invalidate indexes.
- One layout pass builds file/hunk offsets and per-file line locations. Consecutive
  wrapped rows with the same source-line pair share a location span. New-side and
  old-side indexes record whether each side exists. Deletion-only and binary
  files no longer search the full diff for an absent new-side line.
- Position and anchor capture use binary search within the top row's file.
  Anchor restoration uses indexed source-line keys and preserves both line
  numbers when provided. It retains the first wrapped row, the later-row tie
  preference, and the existing file-gap/sticky-header rules.
- Scroll-tail calculation reuses file count and the last header offset from the
  same index. It does not scan rows or copy offset-map values on resize.
- `MainArea` memoizes hunk navigation positions. Each navigation command uses
  binary search rather than rebuilding the flattened hunk list. Missing hunks,
  file boundaries, and clamped-scroll navigation targets remain supported.
- No process coordination changed. These are synchronous layout calculations;
  they do not need new Effect services or concurrency infrastructure.

**Validation:** `bun test` (425 tests), `bun test:e2e` (19 tests), `bun check`,
`bun bench:check`, `bun lint`, and
`bun test ./tests/bench/diff-layout.bench.ts` (four cases) pass.

Native-renderer tests check both views, offset-map identity and callback counts
across 30 scroll updates, horizontal movement, height/width changes, wrapping,
active-file changes, content replacement, and anchor restoration after reflow.
They cover deleted, added, two-sided, binary, and empty files. Independent linear
reference tests check positions and anchors across gaps, file boundaries,
wrapped rows, fractional offsets, and missing sides. A 100,000-line operation-count
check bounds indexed queries, and 100,000 wrapped rows for one source line use
one location span. Live TUI file navigation now also checks next/previous hunk
movement across files at 200 and 100 columns. Existing mode-transition, resize,
and multi-selection tests remain in place.

**Microbenchmarks:** the permanent test separates index preparation from scroll
queries at 100,000 and 500,000 rows, with deletion-only and two-sided input. All
four median query batches average less than 0.01 ms per update. These are batched
function measurements, not sub-millisecond terminal latency measurements.

A separate baseline A1 → candidate B1 → baseline A2 diagnostic uses deletion-only
files with 1,000 display rows per file. The old sequence rebuilds hunk offsets,
file offsets, and tail offsets, then captures position/anchor and restores an
anchor. The candidate reuses its prepared index. Both use the same repeating
200-position sequence. After warmup, 20 batches average 10 baseline updates or
1,000 candidate updates to reduce timer overhead.

| Rows | Baseline A1, ms/update | Indexed B1, ms/update | Baseline A2, ms/update |
| --- | ---: | ---: | ---: |
| 100,000 | 5.35 | <0.01 | 5.43 |
| 500,000 | 35.30 | <0.01 | 37.46 |

Candidate index preparation took 14 and 42 ms in that diagnostic, excluding row
creation. Preparation and retained index data still scale with content. The
index is owned by the current view/layout, not a cache of previous layouts.
P04's full wrapped-row allocation and P11's large-input preparation remain open.

**TUI measurement:** A1 → B1 → A2 → B2 using source `42cb3be0` for the A groups.
A2 used a temporary jj workspace with the same dependencies. All completed
comparisons passed harness compatibility checks. Controller/target Bun 1.4.2,
OpenTUI 0.5.10, Effect 4.0.0-rc.112, and Terminal Control 1.2.1 were fixed.
No tests or builds ran concurrently with measured benchmarks.

Common command:

```sh
/Users/elias/.local/share/mise/installs/bun/1.4.2/bin/bun scripts/benchmark.ts run \
  --bun /Users/elias/.local/share/mise/installs/bun/1.4.2/bin/bun \
  --fixture .kajji-benchmarks/fixtures/stress --scenarios diff \
  --runs 3 --warmups 1 --passes 2 --steps 40 --interval-ms 16 \
  --output /tmp/kajji-p03-MODE-GROUP.json
```

Configurations:
- `unified`: defaults, 120×36 cells, wrapping, line input.
- `split`: add `--layout split --cols 200 --no-wrap`; line input.
- `pages`: replace the step count with `--steps 300`, add `--diff-input page`;
  120×36 cells, unified, wrapping. This crosses file boundaries.

All use the textual engine, dark theme, endpoint-only capture, and the same
prepared fixture with warm filesystem caches. Each group has one excluded warmup
and three measured processes per configuration. Each line-input report applied
all 480 requested positions. Each page report sent 3,600 inputs and moved 3,300
rows per burst in the correct direction. Page input does not have exact per-key
position attribution. These runs do not involve log pagination.

Per-group process medians:

| Metric | A1 | B1 | A2 | B2 |
| --- | ---: | ---: | ---: | ---: |
| Unified content ready, ms | 1,057 | 1,135 | 1,258 | 1,106 |
| Unified highlighted ready, ms | 1,773 | 1,874 | 1,995 | 1,839 |
| Unified first Down input-to-output p95, ms | 19.1 | 16.6 | 18.4 | 16.1 |
| Unified first Down recovery, ms | 8.5 | 5.5 | 6.6 | 6.3 |
| Unified first Up recovery, ms | 4.3 | 3.9 | 2.3 | 4.2 |
| Unified second Down recovery, ms | 9.2 | 13.0 | 14.1 | 10.9 |
| Unified second Up recovery, ms | 7.3 | 2.3 | 6.2 | 3.1 |
| Unified peak Kajji RSS, MiB | 413 | 406 | 411 | 413 |
| Unified Kajji CPU, ms | 3,892 | 3,524 | 3,961 | 3,527 |
| Split content ready, ms | 1,247 | 1,205 | 1,117 | 1,238 |
| Split highlighted ready, ms | 2,252 | 2,110 | 2,038 | 2,429 |
| Split first Down input-to-output p95, ms | 20.7 | 20.0 | 20.6 | 20.3 |
| Split first Down recovery, ms | 27.2 | 20.0 | 14.9 | 15.0 |
| Split second Up recovery, ms | 3.3 | 10.9 | 16.6 | 17.2 |
| Split peak Kajji RSS, MiB | 463 | 457 | 462 | 457 |
| Page content ready, ms | 1,146 | 1,245 | 1,211 | 1,733 |
| Page highlighted ready, ms | 1,832 | 1,991 | 1,922 | 2,716 |
| Page first Down update-gap p95, ms | 26.2 | 27.2 | 28.6 | 106.5 |
| Page first Down maximum update gap, ms | 45.9 | 50.9 | 41.7 | 162.2 |
| Page first Down recovery, ms | 15.8 | 17.6 | 13.9 | 54.4 |
| Page second Up recovery, ms | 4.7 | 7.7 | 9.9 | 14.1 |
| Page peak Kajji RSS, MiB | 619 | 543 | 563 | 539 |

**Timing limits and failed attempts:** B2 page scrolling is materially slower;
that valid report is retained, not discarded. An immediate extra baseline group,
A3, also slowed: first Down update-gap p95 was 129.9 ms and maximum gap was
224.5 ms. A3 contained 33 gaps over 100 ms, compared with 19 in B2, one in A2,
and none in A1/B1. A process check found active browser and window-server CPU
work. This is evidence of an uncontrolled timing environment, not proof of the
cause of every delay or proof that no page-scroll regression exists.

The first B1 page attempt failed for 29.6 ms sender lateness; its unchanged repeat
passed. Two attempts at a further B3 group failed for 24.5 and 38.7 ms lateness.
Timing stopped after these failures. The rate was not reduced, failed reports
were not scored, and other processes were not stopped. A3 has no completed B3/A4
comparison. A quiet-machine page comparison remains follow-up measurement work.
Short unified/split runs had no gaps over 100 ms, but their small viewport region
does not establish long-scroll performance. There is no compiled, network, or
structural-engine timing claim.

**Local evidence:** `/tmp/kajji-p03-{unified,split,pages}-{a1,b1,a2,b2}.json`,
`/tmp/kajji-p03-MODE-A-B.txt`, `/tmp/kajji-p03-pages-a3.json`, and failed reports
beside the page outputs. Microbenchmark evidence is
`/tmp/kajji-p03-micro-{a1,b1,a2}.jsonl`, `/tmp/kajji-p03-micro-compare.mjs`, and
`/tmp/kajji-p03-micro.log`. Validation logs are `/tmp/kajji-p03-{unit,e2e,lint}.log`;
final changes are in `/tmp/kajji-p03-final.diff`. Fixtures and reports remain local.

### P04 — Implementation retained; final performance acceptance open

**Decision:** retain the working implementation for review, but leave P04 unchecked.
Tests confirm compact allocation, bounded word/token preparation, and navigation
correctness. Difficult-pair startup improved substantially in repeated runs.
Other timings varied, and valid page-scroll reports had longer worst-case gaps.
A quiet-machine comparison must establish whether a regression remains.

**Changes:**
- `row-window.ts` stores one height per source row and a numeric prefix-sum array.
  Both diff views create wrapped-row objects only for the viewport and overscan.
  The current slice retains overlapping object identity and releases past slices.
  Width changes do not allocate one object per wrapped display row.
- P03's `DiffLayoutIndex` now accepts source-span heights. Its file/hunk offsets,
  source-line locations, anchors, and scroll-tail calculations retain display-row
  coordinates without iterating over every wrapped row. Metadata-only current-file
  lookup does not prepare word emphasis.
- Textual split alignment records pairs without computing emphasis. Visible pairs
  use a view-owned LRU, limited to 256 entries and 2 MiB of estimated keys, text,
  and segment data. Reflow and revisits can reuse results. Structural alignment
  and supplied emphasis remain separate from textual pairing.
- Word comparison accepts at most 4,096 UTF-16 code units per side and uses
  jsdiff's deterministic `maxEditLength: 128` search bound. Larger or more
  difficult pairs receive whole-line emphasis, with no text removed.
- Syntax entry points and the worker reject highlighting work above 4,096 code
  units, returning plain text instead. Shared token preparation also limits
  structural emphasis to 256 segments and 4,096 total segment code units.
  Excessive input becomes one plain token, with whole-line emphasis when supplied.
  Token slicing therefore scans a bounded short line or slices one long token.
- Overscan remains 50 rows per side. B1 used a map to retain visible-row identity;
  B2 replaces it with an indexed previous-slice array to avoid per-scroll map
  allocation. This allocation change is not separately claimed as a timing gain.
- No process coordination changed; these are synchronous data calculations.
  No new Promise scheduler or Effect service was needed.

**Validation:** `bun test` (437 tests), `bun test:e2e` (19 tests), `bun check`,
`bun bench:check`, and `bun lint` pass. Five cases in
`bun test ./tests/bench/row-preparation.bench.ts` pass. Tests cover deferred word
preparation, cache reuse and limits, long-line fallback, structural emphasis,
empty and one-sided rows, split alignment, tab expansion, Unicode text retention,
newlines, wrapping/no-wrap, resize, file transitions, and P03 index reuse.

A deterministic two-million-display-row test creates three source spans and only
130 requested row objects. Native-renderer tests scroll long changed lines in
both views, cross into the next file, resize, and disable wrapping. Syntax-worker
tests check long-line fallback followed by normal highlighting in both themes.
A separate no-wrap split TUI run and unified wheel run pass as functional checks;
these single runs are not performance baselines.

**Microbenchmarks:** diagnostic medians on Bun 1.4.2 were 0.56 ms for 500 unrelated
words, below 0.01 ms for the over-length 1,000-word fallback, and about 0.02–0.03 ms
for compact reflow plus 130 visible rows at 100,000 and 2,000,000 display rows.
These are candidate-only function measurements, not a new before/after baseline
or terminal latency claim. Operation-count checks provide the deterministic gate.

**TUI configuration:** baseline source `e04b1d13`. Controller and target Bun are
both pinned to 1.4.1, independently of shell Bun 1.4.2. OpenTUI 0.5.10,
Effect 4.0.0-rc.112, jsdiff 8.0.2, and Terminal Control 1.2.1 remain fixed.
This is a new baseline, not a comparison with the older P03 reports.

```sh
/Users/elias/.local/share/mise/installs/bun/1.4.1/bin/bun scripts/benchmark.ts run \
  --bun /Users/elias/.local/share/mise/installs/bun/1.4.1/bin/bun \
  --fixture .kajji-benchmarks/fixtures/stress --scenarios diff \
  --runs 3 --warmups 1 --passes 2 --steps 40 --interval-ms 16 \
  --output /tmp/kajji-p04-MODE-GROUP.json
```

- `unified`: defaults, 120×36 cells, wrapping, line input.
- `split`: add `--layout split --cols 200`; wrapping and line input.
- `pairs`: use split settings and `.kajji-benchmarks/fixtures/p04-pairs`. This local
  generated fixture has two changed TypeScript files, each with 40 changed-line
  pairs and 500 unrelated words per side. Preparation is outside timed runs.
- `pages`: use split settings, `--diff-input page`, and `--steps 300`. Each burst
  moves 3,300 rows and crosses a file boundary.

All use textual diffs, dark theme, endpoint-only capture, the same prepared
fixture per comparison, and warm filesystem caches. Groups follow A1 → B1 → A2
→ B2. A2 page timing failed; a later A3 baseline and B3 final-candidate page group
completed. Completed comparisons pass harness compatibility checks. Every valid
line-input group applies all 480 requested positions. Each valid page group
sends 3,600 inputs and moves 3,300 rows per burst in the requested direction.
Page inputs do not have exact per-key position attribution. Pagination is excluded.

Selected per-group process medians:

| Metric | A1 | B1 | A2 | B2, final code |
| --- | ---: | ---: | ---: | ---: |
| Difficult pairs: content ready, ms | 4,478 | 813 | 4,260 | 1,194 |
| Difficult pairs: highlighted ready, ms | 5,438 | 1,486 | 5,167 | 2,044 |
| Difficult pairs: peak Kajji RSS, MiB | 419 | 359 | 415 | 337 |
| Difficult pairs: first Down p95, ms | 17.7 | 15.9 | 17.3 | 16.2 |
| Difficult pairs: first Down recovery, ms | 4.4 | 6.0 | 5.8 | 12.8 |
| Difficult pairs: second Down recovery, ms | 4.9 | 7.2 | 13.1 | 2.4 |

The final difficult-pair content result is 72–73% lower than both baseline
medians; peak RSS is 19–20% lower. This is a deliberately difficult workload,
not a general startup improvement. First Down recovery increased; its ranges
overlap the baseline ranges. Do not pool first and repeated visits.

For the ordinary stress fixture, final B2 unified startup was 1,288 ms versus
1,034 ms in A2; split startup was 1,537 versus 1,049 ms. First Down p95 was
17.6 versus 18.1 ms in unified mode, and 21.6 versus 19.7 ms in split mode.
Split first Down recovery increased from 12.7 to 31.9 ms. These valid slower
results are retained. They do not establish either a general improvement or
absence of a regression.

**Page-scroll limits:** A1 → B1 first Down maximum-gap medians were 244 → 351 ms.
The final-code A3 → B3 comparison was 431 → 1,032 ms, with B3 process maxima
between 601 and 1,256 ms. Both completed the same movement. Peak Kajji RSS was
598 → 600 MiB; Kajji CPU was 14,748 → 15,860 ms. A3/B3 startup medians were
1,758 → 2,072 ms. These are slow valid reports, not failed runs to discard.

A2 pages failed for 23.6 ms sender lateness; B2 pages failed for 47.9 ms lateness.
The input rate was not reduced. At the end, process inspection found active
Vitest workers and substantial browser/window-server CPU use. This session ran
no tests or builds concurrently with its measured benchmarks, but other work
was active on the machine. That observation does not prove the cause of the
long gaps. Timed runs stopped; quiet-machine confirmation of ordinary startup,
split recovery, and page-scroll tails remains required before P04 acceptance.

**Remaining scope limits:** source-row arrays, height/index preparation, and full
diff parsing still scale with loaded content; P11 remains open. The global syntax
notification and request queue remain P09 work. Normal short emphasis segments
still get separate syntax requests. Wrapping and slicing retain the existing
UTF-16 offset convention; these tests do not establish terminal-cell-correct
clipping for every wide glyph, surrogate pair, or combining sequence. No new
Unicode width policy is introduced. Structural emphasis has unit/native coverage,
but there is no structural-engine or compiled-binary performance claim.

**Local evidence:** `/tmp/kajji-p04-{unified,split,pairs}-{a1,b1,a2,b2}.json`,
`/tmp/kajji-p04-pages-{a1,b1,a3,b3}.json`, comparison files
`/tmp/kajji-p04-MODE-A-B.txt`, and the rejected reports beside page outputs.
Functional reports are `/tmp/kajji-p04-{nowrap,wheel}-smoke.json`.
Validation logs are `/tmp/kajji-p04-{unit,e2e,check,bench-check,lint,micro,native}.log`;
reviewed changes are in `/tmp/kajji-p04-final.diff`. The prepared `p04-pairs`
fixture and its temporary generator `/tmp/kajji-p04-prepare-pairs.ts` remain local.
The baseline workspace `/tmp/kajji-p04-baseline` is retained for the pending
quiet-machine comparison.

### P05 — Retained: coordinated snapshots and fixed-operation reads

**Decision:** implemented and accepted. Unchanged polls use one jj command instead
of three. Changed polls use two instead of three. Bootstrap supplies the initial
snapshot to synchronization. Snapshotting remains enabled for inspections and
mutations. P04's separate acceptance work is not changed by this decision.

**Implementation:**

- `Jj.refreshState` runs snapshot-enabled `jj op log --limit 1 --no-graph --color
  never -T 'self.id()'`. It reads the working-copy commit at that exact operation
  only when the operation differs from the supplied previous state. The old
  `status` plus two independently timed identity reads are removed from this path.
- Effect `RcMap` shares concurrent identical inspections. Zero idle retention
  prevents reuse on later polls; interruption of the final consumer stops the
  producer. Repository, timeout, and previous identity are part of the key.
- Bootstrap passes its state through the root app to `SyncProvider`. Without a
  bootstrap result, synchronization obtains one before starting content reads.
- Refresh snapshots before loading, not afterward. Log, bookmarks, files,
  descriptions, filter/visual-range previews, and textual/jj-formatted details use
  `--at-operation` to read that view without further snapshots. Structural
  upgrades receive the same operation as their textual result. Mutations do not
  inherit this option. Uncoordinated callers retain normal snapshot behavior.
- Poll/focus checks skip active refreshes and reject results from an older refresh
  generation. A detected change supplies its snapshot directly to refresh.
  Repeated full-refresh requests retain one follow-up and the latest supplied
  selection options. Cleanup interrupts outstanding inspections.
- Symbolic detail-sharing keys include the operation; immutable completed content
  remains reusable across operations. Materialized-file keys include repository
  and operation identity. Existing bounded detail caches are retained.

**Event-driven checks:** retained focus events and the existing two-second focused,
30-second unfocused polling fallback. Inspected jj source at the installed
`7c41cdeb16b6b321c64e789a966b6adf723816a5` revision. Snapshot-enabled operation log
performs Git import, stale-workspace checks, and operation-head reconciliation.
An operation-directory watcher alone cannot detect unsnapshotted file edits.
A new recursive working-tree watcher would duplicate jj's filesystem-monitor
work and require linked-workspace, ignored-file, overflow, and platform coverage.
No watcher was added. Both the current repository and the user's large repository
report `fsmonitor.backend = "none"`; Watchman is not installed. No monitor-enabled
speed claim is made.

**Validation:** 446 unit tests, 21 E2E tests, `bun check`, `bun bench:check`, and
`bun lint` passed. Tests cover bootstrap reuse and ordering, pinned captured and
streamed reads, mutation isolation, shared-consumer cancellation, failed-read
retry, real unsnapshotted edits, old-view stability, colocated Git ref import,
divergent-operation reconciliation, stale-workspace detection and repair, and
live poll/focus updates. An earlier full E2E run failed file navigation; that
case passed in isolation and in the final full run. Both logs are retained.

**Command-level A1 → B1 → A2 diagnostics:** independent copies of the prepared
10,000-file stress fixture, pinned Bun 1.4.1, `fsmonitor.backend = "none"`, eight
unchanged inspections and eight inspections after editing `history.ts` per group.
Preparation and copying are outside the interval. All edits were detected;
unchanged passes reported no change. These are service measurements, not TUI
startup or cold-disk measurements. Subprocess sums are command wall times, not
summed CPU; baseline commands can run concurrently.

| Median, ms unless specified | A1 | B1 | A2 |
| --- | ---: | ---: | ---: |
| Bootstrap plus initial inspection, command count | 6 | 4 | 6 |
| Bootstrap plus initial inspection, wall time | 229 | 99 | 185 |
| Unchanged inspection, command count | 3 | 1 | 3 |
| Unchanged inspection, application wall time | 106 | 50 | 100 |
| Unchanged inspection, sum of subprocess wall times | 123 | 49 | 115 |
| Edited inspection, command count | 3 | 2 | 3 |
| Edited inspection, application wall time | 170 | 106 | 138 |
| Edited inspection, sum of subprocess wall times | 189 | 105 | 153 |

**Real-TUI comparison:** final aligned A1 → B1 → A2 against `25d05c1c`, which
includes the separate layout-anchor fix added during this work. Same prepared
stress fixture; controller and target Bun 1.4.1; OpenTUI 0.5.10; Terminal Control
1.2.1; log scenario; three measured processes and one excluded warmup per group;
two down/up passes, 40 steps per direction at 16 ms; 120×36, textual unified,
wrapping enabled, endpoint captures. Pagination is excluded. All 480 requested
positions applied in each group. Comparison compatibility checks passed.

| Per-group process median | A1 | B1 | A2 |
| --- | ---: | ---: | ---: |
| Content ready, ms | 1,162 | 1,030 | 1,119 |
| Highlighted ready, ms | 1,936 | 1,756 | 1,858 |
| First Down p95, ms | 17.6 | 17.7 | 17.4 |
| First Down final recovery, ms | 142 | 78 | 124 |
| Repeat Down final recovery, ms | 13.5 | 13.4 | 12.4 |
| Peak Kajji RSS, MiB | 436 | 434 | 438 |
| Peak process-tree RSS, MiB | 517 | 471 | 491 |
| Kajji CPU, ms | 4,944 | 4,567 | 4,639 |

First-visit final recovery was 38–45% lower than both baseline medians, without
range overlap. Startup medians were lower, but ranges overlap: do not claim a
universal startup reduction. First Down p95 was approximately unchanged. Revisit
recovery, memory, and CPU include overlapping ranges. This supports retaining the
coordination change, not a general scrolling improvement.

**Limits and excluded evidence:** other applications and an external build were
active during parts of this session; this session ran no tests/builds concurrently
with measurements. Early whole-TUI groups used `17288906` as baseline, while the
candidate acquired the separate layout fix. Those groups are not P05-only
comparisons. Two early repeat-baseline attempts failed sender lateness at 24.2
and 29.3 ms and were not scored. The input rate was not reduced. Aligned groups
above were run afterward and completed. Progressive stream publication remains;
this change gives reads one repository operation, not an atomic multi-panel paint.
Action-specific reads outside these display paths still use normal jj semantics.
No enabled-Watchman, network, structural timing, or compiled-startup claim is made.

**Local evidence:** `/tmp/kajji-p05-aligned-{a1,b1,a2}.json`,
`/tmp/kajji-p05-aligned-compare-{a1,a2}-b1.txt`,
`/tmp/kajji-p05-scan-{a1,b1,a2}.json`, and the service measurement script
`/tmp/kajji-p05-scan.mjs`. Early reports and rejected attempts remain under
`/tmp/kajji-p05-{a1,b1,a2,a3}*`. Validation logs are
`/tmp/kajji-p05-{unit,e2e,e2e-final,check,bench-check,lint}.log`;
reviewed changes are in `/tmp/kajji-p05-final.diff`.

### P01–P05 review corrections

- Description reads now fail with `JjCommandError` on non-zero exit. Successful
  empty descriptions use the normal bounded cache. Styled undescribed-commit
  placeholders remain cacheable; failures are not retained.
- Kajji presentation config updates no longer clear repository detail caches or
  trigger a repository refresh. Changes to engine, layout, and wrapping clear
  only the corresponding temporary override. Unrelated changes preserve it.
- Captured and streamed reads use explicit read execution paths that apply
  `--at-operation` without guessing command position. Mutations and intentional
  live snapshot/check commands remain separate.
- Removed five unused diff-layout helpers and their exports. Moved useful offset
  and navigation checks to the replacement indexed APIs.
- Corrected the status header. P02 summary work and P04 performance acceptance
  remain open. The LogPanel viewport/prefetch poll remains for P08.

Validation: 455 unit tests and 21 E2E tests passed, along with `bun check`,
`bun bench:check`, and `bun lint`, using Bun 1.4.2. Added checks for empty-result
reuse, failed-read retry, global-flag ordering, pinned reads, mutation isolation,
and config updates with native-renderer output and command counts. Config tests
use a private process/home and do not write the user's configuration.

The first full E2E run passed 20 tests and timed out entering file-navigation
mode. That test passed alone, then all 21 passed in a second full run. Both full
logs are retained. No timing benchmark was run and no new latency claim is made.
Local evidence: `/tmp/kajji-review-{unit,config,check,bench-check,lint}.log`,
`/tmp/kajji-review-e2e{,-navigation,-final}.log`, and
`/tmp/kajji-review-fixes.diff`.
