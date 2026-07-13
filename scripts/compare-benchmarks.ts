#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

interface MetricSummary {
    median: number
    p95: number
    min: number
    max: number
}

interface BenchmarkReport {
    metadata: { revision: string }
    aggregate: Record<string, MetricSummary>
}

const [baselinePath, candidatePath] = Bun.argv.slice(2)
if (!baselinePath || !candidatePath) {
    console.error("Usage: bun bench:compare <baseline.json> <candidate.json>")
    process.exit(1)
}

function readReport(path: string): BenchmarkReport {
    return JSON.parse(readFileSync(resolve(path), "utf8")) as BenchmarkReport
}

function change(before: number, after: number): string {
    if (before === 0) return "n/a"
    const percentage = ((after - before) / before) * 100
    const prefix = percentage > 0 ? "+" : ""
    return `${prefix}${percentage.toFixed(1)}%`
}

const baseline = readReport(baselinePath)
const candidate = readReport(candidatePath)
const metricNames = Object.keys(baseline.aggregate).filter(
    (name) => candidate.aggregate[name],
)

console.log(
    `Baseline ${baseline.metadata.revision} -> candidate ${candidate.metadata.revision}\n`,
)
console.log(
    `${"Metric".padEnd(24)} ${"Baseline".padStart(12)} ${"Candidate".padStart(12)} ${"Change".padStart(10)}`,
)
console.log("-".repeat(61))

for (const name of metricNames) {
    const before = baseline.aggregate[name]?.median ?? 0
    const after = candidate.aggregate[name]?.median ?? 0
    console.log(
        `${name.padEnd(24)} ${before.toFixed(2).padStart(12)} ${after.toFixed(2).padStart(12)} ${change(before, after).padStart(10)}`,
    )
}

console.log(
    "\nPositive changes mean slower or more memory; interpret noise locally.",
)
