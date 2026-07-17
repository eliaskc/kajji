# Native TUI Learnings

Takeaways from analyzing lazyjj (Rust/ratatui) and jjui (Go/bubbletea), and how their best patterns could apply to kajji.

The main perf issue on large repos is lag on mutating jj commands (`jj new`, etc.), not diff rendering — the custom diff pipeline with Shiki progressive enhancement is working well.

> Historical note: the commander paths and executor sketches below describe the pre-Effect architecture. Process ownership now lives in scoped `Jj`, `AppProcess`, and `InteractiveProcess` services; retain the performance observations, but do not reintroduce the deleted compatibility adapters.

## 1. Streaming log with backpressure (from jjui)

jjui's `GraphStreamer` pulls 50 rows at a time from a live `jj log` process via a Go channel. The process stays alive — the UI requests more batches as the user scrolls. On revset change, the old process is killed immediately via `context.Cancel()`.

kajji currently streams `jj log` output but processes all chunks eagerly. The process runs to completion even if the user only views the first 20 commits.

### Sketch

```
streamLogPage() changes:
- Keep the jj process alive after first batch (don't let it run to completion)
- Add a "pull more" mechanism: SyncProvider calls streamLogPage.next(50) when
  the user scrolls near the bottom of the loaded range
- On revset change: kill the running process (AbortController), start a new one
- Buffer: keep a ReadableStream reader open, read N lines per pull
```

Key change in `executor.ts`: `executeStreaming` needs a "pause/resume" mode — read chunks on demand rather than as fast as possible. Could use a `ReadableStream` with backpressure via the reader's `read()` call (only pull when asked).

## 2. `--ignore-working-copy` everywhere (from jjui)

jjui passes `--ignore-working-copy` on all read-only commands. This prevents jj from snapshotting the working copy on every query — significant perf win on large repos.

### Audit results

Already covered:
- `commander/diff.ts` — fetchDiff, streamDiff
- `diff/parser.ts` — fetchParsedDiff
- `commander/operations.ts` — jjShowDescription, jjShowDescriptionStyled, jjIsInTrunk, jjDiffStats, jjCommitDetails

Missing (high priority — run on every refresh):
- `commander/log.ts` — `buildArgs()`: fixes both fetchLogPage and streamLogPage
- `commander/bookmarks.ts` — fetchBookmarks, fetchBookmarksStream, fetchNearestAncestorBookmarkNames
- `commander/operations.ts` — fetchOpLog, fetchOpLogId

Missing (medium — CLI tools):
- `cli/revisions.ts` — fetchRevisions
- `cli/comment.ts` — readFileLinesAtRevision

Design issue:
- `commander/files.ts` — fetchFiles has the flag as opt-in (`options.ignoreWorkingCopy`) rather than default

## 3. Process cancellation on navigation (from jjui)

jjui kills in-flight jj processes when the user navigates away (e.g. changes revset, switches to a different commit). This avoids wasted work and prevents stale results from arriving late.

kajji's streaming has no cancellation — if you start loading a large diff and switch commits, the old diff process runs to completion.

### Sketch

```
In sync.tsx / MainArea.tsx:
- Track an AbortController per async operation (log stream, diff fetch, file fetch)
- On navigation (selectedCommit changes, revset changes): abort the previous controller
- In executor.ts: executeStreaming accepts an AbortSignal, kills the process on abort
- executeStreaming already returns { cancel } — wire this to AbortController.signal
```

## 4. Askpass server for SSH prompts (from jjui)

jjui runs a Unix socket server that intercepts SSH passphrase prompts (via `SSH_ASKPASS` env var) and shows them as TUI dialogs. This means `jj git push/fetch` with SSH keys works without breaking out of the TUI.

### Sketch

- Spawn a Unix socket server on startup (or lazily on first git operation)
- Set `SSH_ASKPASS` and `SSH_ASKPASS_REQUIRE=force` in the env for all jj git commands
- When askpass client connects: show a password input modal via the dialog system
- Pipe the response back through the socket
- Teardown socket on exit

Lower priority — only matters for SSH key users without an agent.

## Priority

1. **`--ignore-working-copy` gaps** — trivial effort, free perf on large repos
2. **Process cancellation** — low effort, high impact on large repos
3. **Streaming with backpressure** — medium effort, improves initial load and memory on large repos
4. **Askpass server** — nice-to-have, only benefits SSH users
