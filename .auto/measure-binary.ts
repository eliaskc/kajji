import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { loadFixture } from "../scripts/perf/fixture"
import { runScenario } from "./bundled-run"
import type { Settings } from "../scripts/perf/types"
const root = resolve(".")
const binary = resolve(".kajji-benchmarks/startup-auto/bundled/kajji")
const fixture = resolve(".kajji-benchmarks/fixtures/goodmorning")
const manifest = loadFixture(fixture)
const settings: Settings = {
    scenarios: ["diff"], runs: 1, warmups: 0, steps: 20, intervalMs: 16,
    passes: 1, sampleMs: 0, cols: 120, rows: 36,
    diffInput: "line", layout: "unified", wrap: true,
}
const binarySha256 = createHash("sha256").update(readFileSync(binary)).digest("hex")
const run = await runScenario(root, fixture, manifest, mkdtempSync(join(tmpdir(), "kajji-bundled-startup-")), "diff", 0, settings, binary)
const report = { kind: "single-bundled-run", binary, binarySha256, compilerBun: Bun.version, sourceRevision: "b6c5c2e", fixture: manifest.id, settings, run }
const reportPath = resolve(".kajji-benchmarks/startup-auto/bundled/single-run.json")
writeFileSync(reportPath, JSON.stringify(report))
console.log(`Report: ${reportPath}`)
console.log(`METRIC binary_startup_ms=${run.startup.contentReadyOutputMs}`)
console.log(`METRIC highlighted_ms=${run.startup.highlightedReadyOutputMs}`)
console.log(`METRIC first_frame_ms=${run.startup.firstOutputFrameMs}`)
console.log(`METRIC first_visible_ms=${run.startup.firstContentObservedMs}`)
console.log(`METRIC bookmarks_ms=${run.startup.bookmarksLoadedOutputMs}`)
console.log(`METRIC log_ms=${run.startup.logLoadedOutputMs}`)
console.log(`METRIC diff_ms=${run.startup.diffLoadedOutputMs}`)
console.log(`METRIC peak_rss_mib=${run.metrics.peakRssMiB}`)
console.log(`Initial references: ${run.startup.initialBookmarkCount}; initial revisions: ${run.startup.initialLogCount}`)
