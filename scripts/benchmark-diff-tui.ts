#!/usr/bin/env bun

import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { TerminalControl } from "@kitlangton/terminal-control"

interface ProcessSample {
    elapsedMs: number
    phase: "startup" | "scroll" | "settled"
    rssMiB: number
    cpuPercent: number
    processCount: number
}

interface ScrollSample {
    direction: "down" | "up"
    visibleMs: number
    settledMs: number
}

interface MetricSummary {
    median: number
    p95: number
    min: number
    max: number
}

interface InternalDiffProfile {
    fetchMs?: number
    flattenMs?: number
    files?: number
    lines?: number
    renderSignalMs?: number
    renderTotalMs?: number
    fetchRssMiB?: number
    renderRssMiB?: number
}

interface RunResult {
    startupMs: number
    scroll: ScrollSample[]
    peakScrollRssMiB: number
    peakScrollCpuPercent: number
    internal: InternalDiffProfile
}

const projectRoot = resolve(import.meta.dir, "..")
const openTuiPreload = Bun.resolveSync("@opentui/solid/preload", projectRoot)

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        help: { type: "boolean", short: "h" },
        repo: { type: "string", default: "/tmp/kajji-diff-stress" },
        runs: { type: "string", default: "3" },
        cycles: { type: "string", default: "20" },
        cols: { type: "string", default: "120" },
        rows: { type: "string", default: "36" },
        "ready-text": { type: "string" },
        output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
})

if (values.help) {
    console.log(`Usage: bun bench:diff-tui [options]

Options:
  --repo <path>        Existing jj stress repository
  --runs <count>       TUI process runs (default: 3)
  --cycles <count>     Page-down steps, then matching page-up steps (default: 20)
  --cols <count>       Terminal columns (default: 120)
  --rows <count>       Terminal rows (default: 36)
  --ready-text <text>  Optional visible text expected after rendering
  --output <path>      JSON report path
  -h, --help           Show this help`)
    process.exit(0)
}

function positiveInteger(value: string | undefined, name: string): number {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--${name} must be a positive integer`)
    }
    return parsed
}

const repository = resolve(values.repo ?? "/tmp/kajji-diff-stress")
const runCount = positiveInteger(values.runs, "runs")
const cycles = positiveInteger(values.cycles, "cycles")
const viewport = {
    cols: positiveInteger(values.cols, "cols"),
    rows: positiveInteger(values.rows, "rows"),
}
const readyText = values["ready-text"]

if (!existsSync(join(repository, ".jj"))) {
    throw new Error(`Not a jj repository: ${repository}`)
}

function summarize(values: number[]): MetricSummary {
    const sorted = values.slice().sort((a, b) => a - b)
    const percentile = (fraction: number) =>
        sorted[
            Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
        ] ?? 0
    return {
        median: percentile(0.5),
        p95: percentile(0.95),
        min: sorted[0] ?? 0,
        max: sorted.at(-1) ?? 0,
    }
}

async function waitForPid(path: string): Promise<number> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
        if (existsSync(path)) {
            const pid = Number(readFileSync(path, "utf8").trim())
            if (Number.isInteger(pid) && pid > 0) return pid
        }
        await Bun.sleep(10)
    }
    throw new Error(`Timed out waiting for Kajji PID at ${path}`)
}

function readProcessTree(
    rootPid: number,
): Omit<ProcessSample, "elapsedMs" | "phase"> {
    const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,rss=,%cpu="], {
        stdout: "pipe",
        stderr: "ignore",
    })
    if (!result.success) {
        return { rssMiB: 0, cpuPercent: 0, processCount: 0 }
    }

    const processes = new Map<
        number,
        { parentPid: number; rssKiB: number; cpuPercent: number }
    >()
    for (const line of result.stdout.toString().split("\n")) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)$/)
        if (!match) continue
        processes.set(Number(match[1]), {
            parentPid: Number(match[2]),
            rssKiB: Number(match[3]),
            cpuPercent: Number(match[4]),
        })
    }

    const processIds = new Set([rootPid])
    let changed = true
    while (changed) {
        changed = false
        for (const [pid, process] of processes) {
            if (!processIds.has(pid) && processIds.has(process.parentPid)) {
                processIds.add(pid)
                changed = true
            }
        }
    }

    let rssKiB = 0
    let cpuPercent = 0
    let processCount = 0
    for (const pid of processIds) {
        const process = processes.get(pid)
        if (!process) continue
        rssKiB += process.rssKiB
        cpuPercent += process.cpuPercent
        processCount++
    }
    return {
        rssMiB: rssKiB / 1024,
        cpuPercent,
        processCount,
    }
}

function startProcessSampler(rootPid: number) {
    const startedAt = performance.now()
    const samples: ProcessSample[] = []
    let phase: ProcessSample["phase"] = "startup"
    const sample = () => {
        samples.push({
            elapsedMs: performance.now() - startedAt,
            phase,
            ...readProcessTree(rootPid),
        })
    }
    sample()
    const timer = setInterval(sample, 50)
    return {
        setPhase(next: ProcessSample["phase"]) {
            phase = next
            sample()
        },
        stop() {
            clearInterval(timer)
            sample()
            return samples
        },
    }
}

async function waitForProfileMarker(path: string, marker: string) {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
        if (existsSync(path) && readFileSync(path, "utf8").includes(marker)) {
            return
        }
        await Bun.sleep(10)
    }
    throw new Error(`Timed out waiting for ${marker} in ${path}`)
}

function readInternalProfile(path: string): InternalDiffProfile {
    if (!existsSync(path)) return {}
    const profile: InternalDiffProfile = {}
    for (const line of readFileSync(path, "utf8").split("\n")) {
        const separator = line.indexOf(": {")
        if (separator < 0) continue
        const label = line.slice(0, separator)
        let data: Record<string, number>
        try {
            data = JSON.parse(line.slice(separator + 2))
        } catch {
            continue
        }
        if (label.includes("memory:diff-fetch-complete")) {
            profile.fetchRssMiB = data.rssMiB
        } else if (label.includes("memory:diff-render-complete")) {
            profile.renderRssMiB = data.rssMiB
        } else if (label.includes("diff-fetch-complete")) {
            profile.fetchMs = data.fetchMs
            profile.flattenMs = data.flattenMs
            profile.files = data.files
            profile.lines = data.lines
        } else if (label.includes("diff-render-complete")) {
            profile.renderSignalMs = data.signalMs
            profile.renderTotalMs = data.totalRenderMs
        }
    }
    return profile
}

async function runBenchmark(iteration: number): Promise<RunResult> {
    const root = join(
        tmpdir(),
        `kajji-diff-benchmark-${process.pid}-${iteration}`,
    )
    const home = join(root, "home")
    const configDir = join(home, ".config", "kajji")
    const pidFile = join(root, "kajji.pid")
    const profileName = `diff-scroll-${process.pid}-${iteration}`
    const profileFile = join(root, ".kajji-profiles", `${profileName}.log`)
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
        join(configDir, "config.json"),
        JSON.stringify({ autoUpdatesDisabled: true, whatsNewDisabled: true }),
    )

    const terminal = await TerminalControl.make()
    const launchStartedAt = performance.now()
    const session = await terminal.launch({
        command: [
            "/bin/sh",
            "-c",
            'printf "%s\\n" "$$" > "$KAJJI_BENCHMARK_PID_FILE"; exec "$@"',
            "kajji-diff-benchmark",
            process.execPath,
            "--preload",
            openTuiPreload,
            join(projectRoot, "src/index.tsx"),
            repository,
        ],
        cwd: root,
        host: "opentui",
        viewport,
        inheritEnv: true,
        env: {
            HOME: home,
            XDG_CONFIG_HOME: join(home, ".config"),
            XDG_STATE_HOME: join(home, ".local/state"),
            NODE_ENV: "production",
            KAJJI_BENCHMARK_PID_FILE: pidFile,
            KAJJI_PROFILE: "1",
            KAJJI_PROFILE_MEMORY: "0",
            KAJJI_PROFILE_NAME: profileName,
        },
    })
    const pid = await waitForPid(pidFile)
    const sampler = startProcessSampler(pid)

    try {
        await session.screen.waitForText("Revisions", { timeoutMs: 60_000 })
        await waitForProfileMarker(profileFile, "diff-render-complete")
        if (readyText) {
            await session.screen.waitForText(readyText, { timeoutMs: 15_000 })
        }
        await session.screen.waitForIdle({ quietForMs: 250, timeoutMs: 15_000 })
        const startupMs = performance.now() - launchStartedAt

        await session.keyboard.press("Tab")
        await session.keyboard.press("Tab")
        await session.screen.waitForIdle({ quietForMs: 100, timeoutMs: 5_000 })
        sampler.setPhase("scroll")

        const scroll: ScrollSample[] = []
        for (let index = 0; index < cycles * 2; index++) {
            const direction = index < cycles ? "down" : "up"
            const before = await session.screen.capture()
            const startedAt = performance.now()
            await session.keyboard.press(
                direction === "down" ? "Control+D" : "Control+U",
            )
            await session.screen.waitUntil(
                (snapshot) => snapshot.text !== before.text,
                { timeoutMs: 10_000 },
            )
            const visibleMs = performance.now() - startedAt
            await session.screen.waitForIdle({
                quietForMs: 50,
                timeoutMs: 5_000,
            })
            scroll.push({
                direction,
                visibleMs,
                settledMs: performance.now() - startedAt,
            })
        }

        sampler.setPhase("settled")
        await Bun.sleep(250)
        await session.keyboard.type("q")
        await session.waitForExit({ timeoutMs: 5_000 })
        const processSamples = sampler.stop()
        const scrollSamples = processSamples.filter(
            (sample) => sample.phase === "scroll",
        )
        return {
            startupMs,
            scroll,
            peakScrollRssMiB: Math.max(
                0,
                ...scrollSamples.map((sample) => sample.rssMiB),
            ),
            peakScrollCpuPercent: Math.max(
                0,
                ...scrollSamples.map((sample) => sample.cpuPercent),
            ),
            internal: readInternalProfile(profileFile),
        }
    } finally {
        sampler.stop()
        await session.stop()
        await terminal.close()
        rmSync(root, { recursive: true, force: true })
        rmSync(profileFile, { force: true })
    }
}

const runs: RunResult[] = []
for (let iteration = 0; iteration < runCount; iteration++) {
    const run = await runBenchmark(iteration)
    runs.push(run)
    console.log(
        `run ${iteration + 1}: startup ${run.startupMs.toFixed(0)} ms, scroll visible median ${summarize(run.scroll.map((sample) => sample.visibleMs)).median.toFixed(1)} ms, peak RSS ${run.peakScrollRssMiB.toFixed(1)} MiB`,
    )
}

const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    metadata: {
        repository,
        runs: runCount,
        cycles,
        viewport,
        readyText,
        bunVersion: Bun.version,
    },
    runs,
    aggregate: {
        startupMs: summarize(runs.map((run) => run.startupMs)),
        visibleMs: summarize(
            runs.flatMap((run) => run.scroll.map((sample) => sample.visibleMs)),
        ),
        settledMs: summarize(
            runs.flatMap((run) => run.scroll.map((sample) => sample.settledMs)),
        ),
        peakScrollRssMiB: summarize(runs.map((run) => run.peakScrollRssMiB)),
        peakScrollCpuPercent: summarize(
            runs.map((run) => run.peakScrollCpuPercent),
        ),
    },
}

const output = resolve(
    values.output ?? join(projectRoot, ".kajji-benchmarks", "diff-tui.json"),
)
mkdirSync(resolve(output, ".."), { recursive: true })
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(`report: ${output}`)
console.log(
    `visible latency: median ${report.aggregate.visibleMs.median.toFixed(1)} ms, p95 ${report.aggregate.visibleMs.p95.toFixed(1)} ms`,
)
console.log(
    `settled latency: median ${report.aggregate.settledMs.median.toFixed(1)} ms, p95 ${report.aggregate.settledMs.p95.toFixed(1)} ms`,
)
