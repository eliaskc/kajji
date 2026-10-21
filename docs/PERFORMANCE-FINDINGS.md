# Performance findings and investigation leads

This is a local findings list, not an issue tracker or a claim that every cause
is known. See [BENCHMARKING.md](BENCHMARKING.md) for measurement methods.
No GitHub issues have been filed for these entries.

See [PERFORMANCE-PLAN.md](PERFORMANCE-PLAN.md) for the ordered implementation
checklist, the 2026-09-06 investigation results, and acceptance checks. Use that
plan to track completion; this file retains the earlier observations.

## Fixed: immediate bookmark submission used stale text

- **Evidence:** With the bookmark input focused, sending `immediate-submit\r`
  in one terminal input packet created the generated `push-…` bookmark instead
  of `immediate-submit`. This reproduced in the live E2E test.
- **Cause in Kajji:** `BookmarkNameModal.handleSave` read a signal populated by
  content-change notifications, rather than the current editable buffer. Enter
  can be handled before that notification updates the signal.
- **Change:** Read `inputRef.plainText` at submission, with the signal as a
  fallback when there is no renderable. The same no-wait test now passes.
- **Regression coverage:** `submits bookmark text and Enter in one input packet`
  in `tests/e2e/workflows.test.ts`. There is deliberately no paint/idle wait
  between the text and Enter. Other input modals have not been audited here.

## Open: fast log pagination did not preserve all requested movement

- **Evidence from early harness validation:** An 80-key downward run on the
  small generated fixture advanced 76 positions. The final log contained 101
  revisions, so there was room for the requested position. The run was rejected.
- **Follow-up, 2026-09-06:** An endpoint-mode run sent and received all 80 Down
  inputs but moved only 69 positions. The final log had 101 revisions; maximum
  sender lateness was 1.37 ms. Code inspection found that `selectNextCommit`
  returns while `logLoadingMore()` is true, even with loaded rows available.
  This identifies a dropped-input path, not the cause of every log delay.
- **Next check:** See P08 in [PERFORMANCE-PLAN.md](PERFORMANCE-PLAN.md). Add a
  delayed-page regression test and preserve requested movement during loading.
  Record page request/cancellation times and input receipt around the boundary.
  Compare requests with applied movement, not just FPS.
- **Starting command:**

  ```sh
  bun bench:tui --fixture .kajji-benchmarks/fixtures/small \
    --scenarios log --steps 80 --interval-ms 16
  ```

  Prepare the small fixture as described in the benchmark guide. Initial page
  prefetch varies with timing, so this command is not guaranteed to reproduce
  the failure on every run. A failed report is evidence, not a smoothness score.

## Open: initial streamed log data can trigger a replacement page request

- **Evidence:** Startup traces from the large fixture contained 100 loaded log
  entries rather than the initial 50. Code inspection of `loadMoreLog` in
  `src/context/sync.tsx` shows that it increments the stream token, cancels the
  current stream, and requests `logLimit + 50`. A partial initial batch can cause
  the viewport's prefetch logic to call this before `loadLog` completes.
- **Lead:** Cancellation and replacement can add startup work. The extra cost
  and whether the prefetch is useful for the visible viewport are not measured
  separately yet.
- **Next check:** Record both command lifetimes and first visible rows. Test
  delaying prefetch until initial-page completion without delaying visible data
  or causing navigation to stop at a page boundary.
- The readiness observer recognizes successful replacement-page completion.
  That corrects the measurement contract; it does not fix the extra work.

## Open: highlighting adds a separate startup delay

- **Evidence:** A review run reported log/bookmarks/diff loaded around 0.9–1.0 s,
  with the highlighted state ready around 1.67 s. This is one workload, not a
  general 700 ms worker-boot measurement.
- **Measurement:** The harness reports `contentReadyOutputMs` and
  `highlightedReadyOutputMs` separately. `highlightingAfterContentMs` is the
  gap between those output frames.
- **Follow-up, 2026-09-06:** A stress-fixture run reached content readiness at
  1.58 s and highlighting readiness at 2.33 s. Isolated tests of three fresh
  workers per engine found worker readiness around 94 ms with the current
  JavaScript engine, followed by 623–636 ms for the first TypeScript token.
  A temporary Oniguruma/WASM variant took 28–33 ms for that token after readiness.
  Oniguruma is the regex engine inside Shiki, not a replacement highlighter.
- **Next check:** See P06 in [PERFORMANCE-PLAN.md](PERFORMANCE-PLAN.md). Compare
  supported engines in the full app, test more languages and compiled builds,
  and review maintenance risks. These isolated results are not proof of a
  600 ms whole-app startup improvement.
- **Follow-up, 2026-10-21:** Switching the worker to `@pierre/highlights`
  reduced full-app `highlightedReadyOutputMs` on the stress fixture from about
  1.63 s to 0.97 s. The remaining gap after content readiness is about 50 ms.
  See the P06 result.

## Open: log navigation has substantial detail recovery in a reference repository

- **Evidence from early reference runs with periodic screen sampling:** At a 16 ms key interval, log
  input-to-output p95 was about 79–102 ms and final detail/highlighting recovery
  was about 2.2–3.3 s. These were two runs, not a stable statistical baseline.
- **Next check:** Establish endpoint-mode baselines on the same copied
  revision. Separate subprocess wait, obsolete requests, parsing, and rendering
  before changing caches or cancellation.
- Reports remain private under `.kajji-benchmarks/`; source content is not copied
  into this document. Keep observation settings fixed when comparing runs.

## Open: other immediate-input and rapid-layout races

- Earlier functional tests failed intermittently around modal focus, palette
  filtering, and rapid layout changes. Completed-state waits made the intended
  functional workflows reliable, but did not prove the fast paths correct.
- The new first-visible-cursor test passes for the bookmark modal. The immediate
  submission test exposed and now guards the fixed bug above. Neither establishes
  correctness for all modals or all repeated transitions.
- **Next check:** Add immediate-input tests for the palette and other editors,
  and a separate rapid-layout-toggle test. Do not add waits to such tests merely
  to make them pass.

## Measurement finding: periodic screen reads interfere with input

- In a reference repository, runs with 32 ms screen polling made the sender late.
  A 128 ms diagnostic interval passed the same 16 ms input schedule.
- Trace-file writes also had long wall times under load. They are asynchronous
  and drained at shutdown; serialization and write time are reported separately.
- The harness defaults to start/end-only captures during each burst. Native frame
  and input timing remain continuous. Periodic screen reads are a separate
  diagnostic mode, not an application optimization.
- Input and screen capture still use the same Terminal Control driver. A second
  client must not be assumed to remove shared worker or lock contention.
