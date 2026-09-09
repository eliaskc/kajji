# Autoresearch: Kajji startup

## Objective
Reduce real TUI fresh-process startup to loaded log, bookmarks, and selected diff. Do not optimize only a synthetic workload. Reuse prepared stress and copied goodmorning fixtures. These are warm-filesystem, prepared-working-copy measurements, not cold disk.

## Metrics
- Primary: startup_ms (ms, lower): geometric mean of per-fixture median contentReadyOutputMs, equally weighted.
- Secondary: stress_ms, real_ms, highlighted_ms, first_frame_ms, recovery_ms.

## How to run
`bash .auto/measure.sh`. Uses the existing real TUI harness with fixed readiness, observations, runtime, fixture, 3 measured runs and 1 warmup per fixture, diff scenario, 20 steps, 1 pass. Each launch still verifies highlighted readiness and real navigation. Do not run CPU-heavy work concurrently. Reports are retained under .kajji-benchmarks/startup-auto/.

## Scope
Application source in src (except benchmark observer/readiness hooks), relevant unit tests. Prefer small changes that remove redundant work or improve import/loading paths. No new dependencies unless separately approved. Preserve errors, repository refresh semantics, cancellation, highlighting, and configuration behavior.

## Off limits
Do not alter scripts/perf, prepared fixtures, src/utils/benchmark.ts, readiness/position hooks, or production behavior based on benchmark environment. Do not weaken tests or postpone required content beyond the measured boundary. No hidden warm caches across processes. Keep measurement definition fixed; changing it requires a new baseline.

## Validation
Run bun check and bun test after successful measurements via checks.sh. Check focused formatting for changed code. Use E2E tests for retained TUI behavior changes, outside measured runs. Inspect jj diff --git. log_experiment manages experiment commits/reverts; do not manually commit or revert.

## What's been tried
Initial base: 996dbf68. Existing fixtures: stress (synthetic) and goodmorning (copied real repo). Historical reports use older readiness definitions and are NOT comparable.
- Run 1 baseline: startup 1862ms, stress 1029ms, real 3370ms.
- Retained: App dynamic import overlapped with repositoryStatus (435598b), bounded ANSI cache reuse in BookmarkStackRowView (afe46da). Best 1712ms, stress 921ms, real 3184ms. These small gains are NOT strongly attributable: an original-code A repeat was 1757ms, and unchanged candidate varied 1731–1827ms.
- Discarded: incremental bookmark parsing twice (runs 2,7), memoized local bookmark filtering (8), unused ghostty registration removal (9), Shiki core imports (10), Oniguruma regex engine (11). See log ASI for details. Do not thrash by repeating these unchanged ideas.
- Oniguruma dramatically shortens syntax catch-up but did NOT improve primary content startup; save for separate highlighting work. No new dependencies required.
- Source inspection: real bookmark stream pauses ~300ms for each of three adjacent entries then emits many small batches. Suspect per-target jj template empty()/ID cost; bulk unique-target metadata is a larger design change to discuss first.
- Source clones /tmp/opentui, /tmp/pierre, /tmp/shiki were updated. OpenTUI default preload transforms JSX/TSX, not plain jj.ts; earlier ASI speculation about jj.ts transform cache is unproven.
- Machine has substantial unrelated CPU load (load ~12, Sandbed, WindowServer, Figma, other Pi). Do not stop user processes. Be conservative about speed claims; the dashboard confidence is not a causal proof.
- Tests/typecheck pass each measured run. E2E: 20 pass, file-navigation test fails identically on original base in /tmp/kajji-startup-e2e-baseline (jj workspace). Failure expects view marker absent but it is visible at bottom. Do not weaken test; outside startup scope.
- Retained tui.tsx Promise.all currently needs oxfmt line collapsing. A formatting fix bundled with run 9 was discarded. Fix in a later kept run.

