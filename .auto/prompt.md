# Autoresearch: compiled Kajji startup

## Latest experiment (run37)
Concurrent Git probe and jj refresh-state reads after root resolution discarded: primary397.132ms vs best369.028ms (+7.6%); stress225.043ms, real700.815ms. Three deterministic regression tests and all checks passed, but no performance benefit. Real samples included1578ms outlier; do not attribute all slowdown to concurrency. Source restored; zero-byte new-test rollback artifact removed. Do not retry unchanged. Seek substantial repeated post-first-frame work.

## Latest verification (run36)
Fresh rebuild, no app changes: primary370.261ms vs best369.028ms (+0.33%), real672.014ms,stress204.003ms,first-frame124.894ms,first-visible147.328ms,highlighting782.111ms,peakRSS275.03MiB. Logged discard only because slower than best; retained app unchanged. Tests and types pass. This supports repeatability of the current tradeoff, NOT an additional optimization. Avoid further engine toggling without a changed hypothesis.

## Latest retained state (run35)
Current best compiled primary369.028ms (geometric mean): stress202.513ms, real672.457ms; first-visible138.929ms averaged fixture medians; peakRSS275.75MiB; highlighted-ready783.265ms averaged medians. Retained JavaScript regex engine again WITH release ESM bytecode enabled (f26c057). Compared with Oniguruma+bytecode: primary2.6% lower, memory25.5% lower, but highlighting-ready490→783ms slower. Small primary gain needs repeat; do not hide highlighting tradeoff.
User approved release-build option experiments. scripts/build.ts now sets format:"esm",bytecode:true. .auto/build-binary.ts follows those actual flags from the production recipe, including after reverts, and always rebuilds. Binary101.85MiB vs84.43MiB without bytecode; binary_mib is an additional secondary metric. .auto builder supports explicit KAJJI_BUILD_ROOT/TARGET/OUTPUT for controls/validation.
Bytecode evidence: retained run33 primary378.980ms, first-frame130.425ms; disabling ONLY bytecode (run34) raised primary439.100ms and first-frame166.400ms. Same code, compiler, fixtures, warmups and readiness; this is a fair compiled control.
Original996dbf68 compiled A (run27) real3177ms vs following current B (run28) real1063ms under higher machine load; stress362→383ms did not improve. Strong workload-specific full-bookmark-loading gain, not a universal first-paint speedup. NEVER compare source-era baseline to current compiled headline.
Latest E2E:21/21 pass. Compiled CLI help/version pass; darwin-x64 compilation and --version under Rosetta pass. Linux builds blocked by missing @opentui/core-linux-*-musl packages; the same failure reproduces original source before bytecode. No new dependencies installed; Linux runtime not validated.
Other compiled discards: sequential log-prefetch wait(run26), worker smol mode(run29), PR metadata coalescing(run30) did not improve primary. Do not retry unchanged. Multilingual tests are now retained and type-correct(30 languages x2 themes); old run23 instruction to restore patch below is historical.

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
