# Local Performance Benchmarking

Kajji's TUI benchmark is an advisory before/after measurement. It is not run in
CI and does not enforce thresholds.

## TUI benchmark

```sh
bun bench:tui
```

The harness creates a deterministic jj repository and local Git remote under the
OS temporary directory. Repository creation is not timed. Each measured run:

1. launches Kajji through Terminal Control at 120x36
2. waits for the revision and detail panels to settle
3. runs a local `jj git fetch`
4. repeatedly navigates between revisions and loads their details
5. waits in the final state, then measures shutdown

While Kajji runs, the harness samples its RSS and descendant process RSS with
`ps`. Reports are written to the ignored `.kajji-benchmarks/` directory.

Options:

```sh
bun bench:tui --runs 10 --cycles 50 --commits 250
bun bench:tui --output /tmp/kajji-baseline.json
```

Run benchmarks on the same machine under similar load. For migration work,
record a baseline before changing production code and use the same fixture and
run settings afterward.

## Compare reports

```sh
bun bench:compare \
  .kajji-benchmarks/baseline.json \
  .kajji-benchmarks/candidate.json
```

The comparison prints median changes. Positive values mean slower execution or
more memory. Treat small differences as noise and repeat suspicious results.

Useful measurements include startup and fetch latency, navigation p95, peak
Kajji RSS, peak process-tree RSS, and RSS growth over the navigation soak. RSS
growth is not automatically a leak: warmed caches and the final selected diff
can retain useful data.

The existing `bun test:bench` microbenchmarks remain useful for parser and diff
rendering regressions. They complement rather than replace the whole-process TUI
benchmark.
