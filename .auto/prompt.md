# Autoresearch: compiled Kajji startup

## Current objective
User resumed optimization after comparing a short video of the installed app. Optimize compiled/release-settings binaries, not source launches. Never cheat by changing readiness, removing required data, or measuring a stale binary. Continue until interrupted.

## Active benchmark
`bash .auto/measure.sh` rebuilds current source via .auto/build-binary.ts, then runs .auto/measure-bundled-suite.ts. Build uses the same entrypoints, minification, browser conditions, embedded worker and darwin-arm64 compile flags as scripts/build.ts. It does not overwrite the installed executable.

Primary: bundled_startup_ms, lower is better: geometric mean of per-fixture median contentReadyOutputMs for stress and goodmorning. This combined value is not an individual launch time.
Secondary: stress_ms, real_ms, first_visible_ms, first_frame_ms, highlighted_ms, recovery_ms, peak_rss_mib.
Each fixture has one excluded warmup and three measured fresh processes. Order rotates between repetitions. Same 120x36 viewport, textual unified wrapped diff,20 line-scroll inputs per direction,1 pass. All runs verify content/highlight readiness and real movement. Warmup reports are retained separately. No CPU-heavy work concurrently.

Reports: .kajji-benchmarks/startup-auto/bundled-suite/<timestamp>/{stress,goodmorning}.json, including SHA256 of compiled binary. The .auto/bundled-run.ts adapter is a copy of scripts/perf/run.ts with ONLY launch argv (compiled binary instead of Bun/source/preload) and module import paths changed. Readiness, observer, screen validation and resource sampling are unchanged. Do not alter them.

## Scope and constraints
src application code except src/utils/benchmark.ts and readiness/position hooks; relevant regression tests. No new dependencies without approval. Preserve colors, aliases, conflicts, remotes, cancellation, errors and complete accessible data. Prepared fixtures, scripts/perf and observation semantics are off limits. If metric/workload changes, init_experiment and establish a new baseline.

Checks: .auto/checks.sh runs bun check then bun test after passing benchmark. Focused lint/format checks manually. E2E outside benchmarks. log_experiment handles commits/reverts; no manual commits. Use jj log/status/diff for inspection.

## Current compiled segment
- Run21 baseline: primary453.324ms; stress263.179ms; real780.846ms; first-visible187.387ms (average fixture medians); highlighted875.976ms; peakRSS274.55MiB.
- Run22 retained Oniguruma engine (265c0d0): primary431.161ms; stress266.094ms; real698.625ms; highlighted525.644ms; RSS346.94MiB. Clear syntax improvement, modest primary gain; memory tradeoff needs checking. Built binary successfully embeds WASM. Source worker imports full shiki factory and createOnigurumaEngine(import('shiki/wasm')).
- Run23 Shiki core imports discarded/checks_failed. Primary437.127ms; no RSS benefit. Multilingual test passed runtime243 assertions but inferred string[][] failed strict tuple typecheck. Restore .auto/multilingual-tests.patch and declare samples: [string,string][] before next verification. Do not retry core imports unchanged.

## Prior retained application work
Base before session996dbf68. App import overlaps repository inspection; BookmarkStackRowView uses bounded ANSI parse cache. Shared bookmark target descriptions (b6c5c2e) are the main win: expensive empty/description formatting once per unique commit, same per-reference ID aliases and bookmark_list color scope. Uses full128-hex operation IDs only; fallback single read for symbolic/unpinned operations and deleted/conflicted refs. Representative refs grouped by remote and bounded argv,concurrency4. Prefix accumulator joins downstream of concurrent streams to preserve publication order.17 tests cover native/default/all-remotes/custom colors/aliases, conflicts/deleted refs, fallback, cancellation and errors. User explicitly approved this larger change.

## Earlier measurements and video
Source loop was geometric mean stress/real and is archived in .auto/measure-source.sh; do not compare with compiled numbers. Single newly built binary run:2015.6ms, first-visible1293.9ms. Identical binary next launch:897.1ms, first-visible240.7ms. These demonstrate one-time/environment variation, NOT a code gain. Earlier single reports in bundled/first-launch.json and bundled/single-run.json.
Video is0.708s: layout0.317s,bookmarks0.450s,log and EMPTY selected revision visible0.533s. Enter origin uncertain; video does not prove all bookmarks finished loading. Fixture uses different revision/config and full required-data readiness. Do not present video and fixture as identical workloads.

## Discards and remaining leads
- Source-loop incremental parsing twice, local filter memoization, unused ghostty registration removal, theme-color memoization, sync.tsx->.ts conversion did not improve primary. Avoid thrashing. See log ASI.
- Oniguruma/core were originally discarded on source workload; only Oniguruma improved under new compiled measurement. Core still did not.
- Machine CPU load varies; no control of user processes. Require repeats and A/B/A before small causal speed claims.
- E2E20/21 pass. File-navigation failure reproduces unchanged base in /tmp/kajji-startup-e2e-baseline; do not weaken test. Further E2E after final retained changes needed.
- Updated dependency clones: /tmp/shiki,/tmp/opentui,/tmp/pierre,/tmp/jj. Inspect current source when investigating APIs.
- Tool rollback of newly renamed file once left zero-byte src/context/sync.ts shadowing sync.tsx; cleaned that own artifact. Check status after future discarded new files.
