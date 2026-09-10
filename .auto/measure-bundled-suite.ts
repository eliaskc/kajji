import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { loadFixture } from "../scripts/perf/fixture"
import { runScenario } from "./bundled-run"
import type { Run, Settings } from "../scripts/perf/types"

const root = resolve(".")
const binary = resolve(".kajji-benchmarks/startup-auto/bundled/kajji")
const binarySha256 = createHash("sha256").update(readFileSync(binary)).digest("hex")
const settings: Settings = {
    scenarios: ["diff"], runs: 3, warmups: 1, steps: 20, intervalMs: 16,
    passes: 1, sampleMs: 0, cols: 120, rows: 36,
    diffInput: "line", layout: "unified", wrap: true,
}
const names = ["stress", "goodmorning"] as const
const fixtures = names.map(name => {
    const path = resolve(`.kajji-benchmarks/fixtures/${name}`)
    return { name, path, manifest: loadFixture(path), runs: [] as Run[], warmups: [] as Run[] }
})
const output = resolve(`.kajji-benchmarks/startup-auto/bundled-suite/${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(output, { recursive: true })
for (let iteration = -1; iteration < settings.runs; iteration++) {
    const order = iteration % 2 === 1 ? [...fixtures].reverse() : fixtures
    for (const fixture of order) {
        const run = await runScenario(root, fixture.path, fixture.manifest, mkdtempSync(join(tmpdir(), "kajji-bundled-suite-")), "diff", iteration, settings, binary)
        if (iteration < 0) fixture.warmups.push(run)
        else fixture.runs.push(run)
        writeFileSync(join(output, `${fixture.name}.json`), JSON.stringify({ binary, binarySha256, compilerBun: Bun.version, settings, fixture: fixture.manifest.id, runs: fixture.runs, warmups: fixture.warmups }))
    }
}
const median = (values: number[]) => {
    if (!values.length || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error("Invalid metric samples")
    const sorted = [...values].sort((a,b) => a-b)
    const middle = Math.floor(sorted.length/2)
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle-1]! + sorted[middle]!)/2
}
const startup = fixtures.map(f => median(f.runs.map(r => r.startup.contentReadyOutputMs!)))
const metric = (key: string) => fixtures.reduce((sum, f) => sum + median(f.runs.map(r => r.startup[key]!)), 0)/fixtures.length
console.log(`Reports: ${output}`)
for (const f of fixtures) console.log(`${f.name} startup samples: ${f.runs.map(r => r.startup.contentReadyOutputMs!.toFixed(2)).join(", ")}`)
console.log(`METRIC bundled_startup_ms=${Math.sqrt(startup[0]! * startup[1]!)}`)
console.log(`METRIC stress_ms=${startup[0]}`)
console.log(`METRIC real_ms=${startup[1]}`)
console.log(`METRIC first_visible_ms=${metric("firstContentObservedMs")}`)
console.log(`METRIC first_frame_ms=${metric("firstOutputFrameMs")}`)
console.log(`METRIC highlighted_ms=${metric("highlightedReadyOutputMs")}`)
console.log(`METRIC recovery_ms=${median(fixtures.flatMap(f => f.runs.flatMap(r => r.bursts.map(b => b.metrics.recoveryMs!))))}`)
console.log(`METRIC peak_rss_mib=${Math.max(...fixtures.flatMap(f => f.runs.map(r => r.metrics.peakRssMiB!)))}`)
