- Copied repository bookmark stream pauses about 300 ms per entry at three adjacent entries, then sends many small batches. Investigate jj template repeated empty() and short-ID formatting for local/remote targets. A bulk metadata read per unique commit might remove duplicate tree work, but it must preserve colored templates, conflicts, ordering, and operation consistency. This is a larger design change; discuss before expanding scope.
- Source startup includes JSX compilation. Check installed/compiled startup separately before claiming that import changes improve released binaries.
- Primary measurements vary with the environment: original-code A repeat was 1757ms versus initial baseline 1862ms. Do not attribute all cumulative gain to code.

- Run51 combined bookmark identity equality demonstrably avoids repeated PR queries (integration test failed before, passed after), but378.18ms did not beat historical369.03ms. Patch and regression test: .auto/bookmark-publication.patch. Separate efficiency lead; do not keep timing retries until lucky.

- Investigate build-time Shiki grammar precompilation to avoid runtime regex conversion. Check available tooling first; seek approval before new dependencies or large generated artifacts. Preserve all languages and themes.
