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
Initial base: 996dbf68. Clean working copy before setup. Existing fixtures: stress (synthetic) and goodmorning (copied real repo). Historical reports use older readiness definitions and are NOT comparable. Establish a fresh baseline before source changes.
