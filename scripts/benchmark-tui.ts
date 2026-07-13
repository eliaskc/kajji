#!/usr/bin/env bun

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { TerminalControl } from "@kitlangton/terminal-control"

interface MemorySample {
    elapsedMs: number
    phase: string
    kajjiRssKiB: number
    treeRssKiB: number
    processCount: number
}

interface MemorySummary {
    startupKajjiRssMiB: number
    peakKajjiRssMiB: number
    peakTreeRssMiB: number
    endingKajjiRssMiB: number
    endingTreeRssMiB: number
    rssGrowthMiB: number
    maxProcessCount: number
}

interface BenchmarkRun {
    startupMs: number
    fetchMs: number
    navigationMs: number[]
    shutdownMs: number
    memory: MemorySummary
}

interface MetricSummary {
    median: number
    p95: number
    min: number
    max: number
}

interface BenchmarkReport {
    version: 1
    createdAt: string
    metadata: {
        revision: string
        dirty: boolean
        bunVersion: string
        jjVersion: string
        platform: string
        arch: string
        fixtureCommits: number
        navigationCycles: number
        runs: number
        viewport: { cols: number; rows: number }
    }
    runs: BenchmarkRun[]
    aggregate: Record<string, MetricSummary>
}

const projectRoot = resolve(import.meta.dir, "..")
const openTuiPreload = Bun.resolveSync("@opentui/solid/preload", projectRoot)
const viewport = { cols: 120, rows: 36 }

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        help: { type: "boolean", short: "h" },
        runs: { type: "string", default: "5" },
        cycles: { type: "string", default: "20" },
        commits: { type: "string", default: "120" },
        output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
})

if (values.help) {
    console.log(`Usage: bun bench:tui [options]

Options:
  --runs <count>       TUI process runs (default: 5)
  --cycles <count>     Navigation cycles per run (default: 20)
  --commits <count>    Fixture revisions (default: 120)
  --output <path>      JSON report path
  -h, --help           Show this help`)
    process.exit(0)
}

const runCount = positiveInteger(values.runs, "runs")
const navigationCycles = positiveInteger(values.cycles, "cycles")
const fixtureCommits = positiveInteger(values.commits, "commits")

function positiveInteger(value: string | undefined, name: string): number {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--${name} must be a positive integer`)
    }
    return parsed
}

function runCommand(cwd: string, command: string[]): string {
    const result = Bun.spawnSync(command, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
    })
    if (!result.success) {
        throw new Error(
            `${command.join(" ")} failed:\n${result.stderr.toString().trim()}`,
        )
    }
    return result.stdout.toString().trim()
}

function createFixture(root: string, commitCount: number) {
    const repository = join(root, "repo")
    const remote = join(root, "remote.git")
    mkdirSync(repository)

    runCommand(root, ["git", "init", "--bare", remote])
    runCommand(repository, ["jj", "git", "init"])
    runCommand(repository, [
        "jj",
        "config",
        "set",
        "--repo",
        "user.name",
        "Kajji Benchmark",
    ])
    runCommand(repository, [
        "jj",
        "config",
        "set",
        "--repo",
        "user.email",
        "kajji-benchmark@example.com",
    ])
    runCommand(repository, ["jj", "git", "remote", "add", "origin", remote])

    for (let index = 0; index < commitCount; index++) {
        const padded = String(index).padStart(4, "0")
        writeFileSync(
            join(repository, "history.txt"),
            Array.from(
                { length: 80 + (index % 40) },
                (_, line) => `benchmark history ${padded} line ${line}\n`,
            ).join(""),
        )
        if (index % 12 === 0) {
            writeFileSync(
                join(repository, `module-${padded}.ts`),
                `export const revision = ${index}\n`,
            )
        }
        runCommand(repository, [
            "jj",
            "commit",
            "-m",
            `benchmark revision ${padded}`,
        ])
    }
    runCommand(repository, ["jj", "bookmark", "create", "main", "-r", "@-"])
    runCommand(repository, ["jj", "git", "push", "--bookmark", "main"])

    writeFileSync(
        join(repository, "working-copy.ts"),
        Array.from(
            { length: 500 },
            (_, index) => `export const benchmarkDetail${index} = ${index}\n`,
        ).join(""),
    )
    runCommand(repository, ["jj", "describe", "-m", "benchmark tip"])

    return { repository }
}

function createBenchmarkHome(root: string, iteration: number): string {
    const home = join(root, `home-${iteration}`)
    const configDir = join(home, ".config", "kajji")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
        join(configDir, "config.json"),
        JSON.stringify({ autoUpdatesDisabled: true, whatsNewDisabled: true }),
    )
    return home
}

function readProcessTree(
    rootPid: number,
): Omit<MemorySample, "elapsedMs" | "phase"> {
    const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,rss="], {
        stdout: "pipe",
        stderr: "ignore",
    })
    if (!result.success) {
        return { kajjiRssKiB: 0, treeRssKiB: 0, processCount: 0 }
    }

    const processes = new Map<number, { parentPid: number; rssKiB: number }>()
    for (const line of result.stdout.toString().split("\n")) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/)
        if (!match) continue
        processes.set(Number(match[1]), {
            parentPid: Number(match[2]),
            rssKiB: Number(match[3]),
        })
    }

    const processIds = new Set([rootPid])
    let added = true
    while (added) {
        added = false
        for (const [pid, process] of processes) {
            if (!processIds.has(pid) && processIds.has(process.parentPid)) {
                processIds.add(pid)
                added = true
            }
        }
    }

    let treeRssKiB = 0
    for (const pid of processIds) treeRssKiB += processes.get(pid)?.rssKiB ?? 0
    return {
        kajjiRssKiB: processes.get(rootPid)?.rssKiB ?? 0,
        treeRssKiB,
        processCount: processIds.size,
    }
}

async function waitForPid(path: string): Promise<number> {
    const deadline = performance.now() + 5_000
    while (performance.now() < deadline) {
        if (existsSync(path)) {
            const pid = Number(readFileSync(path, "utf8").trim())
            if (Number.isInteger(pid) && pid > 0) return pid
        }
        await Bun.sleep(10)
    }
    throw new Error("Kajji did not publish its benchmark PID")
}

function startMemorySampler(pid: number) {
    const samples: MemorySample[] = []
    const startedAt = performance.now()
    let phase = "startup"
    let stopped = false
    let sampling = false

    const sample = () => {
        if (stopped || sampling) return
        sampling = true
        try {
            samples.push({
                elapsedMs: performance.now() - startedAt,
                phase,
                ...readProcessTree(pid),
            })
        } finally {
            sampling = false
        }
    }

    sample()
    const timer = setInterval(sample, 100)
    return {
        setPhase(nextPhase: string) {
            phase = nextPhase
            sample()
        },
        stop() {
            stopped = true
            clearInterval(timer)
            sample()
            return samples
        },
    }
}

function summarizeMemory(samples: MemorySample[]): MemorySummary {
    const valid = samples.filter((sample) => sample.kajjiRssKiB > 0)
    const startup = valid.filter((sample) => sample.phase === "startup").at(-1)
    const ending = valid.at(-1)
    const startupKajjiRssMiB = kibToMib(startup?.kajjiRssKiB ?? 0)
    const endingKajjiRssMiB = kibToMib(ending?.kajjiRssKiB ?? 0)
    return {
        startupKajjiRssMiB,
        peakKajjiRssMiB: kibToMib(
            Math.max(0, ...valid.map((sample) => sample.kajjiRssKiB)),
        ),
        peakTreeRssMiB: kibToMib(
            Math.max(0, ...valid.map((sample) => sample.treeRssKiB)),
        ),
        endingKajjiRssMiB,
        endingTreeRssMiB: kibToMib(ending?.treeRssKiB ?? 0),
        rssGrowthMiB:
            Math.round((endingKajjiRssMiB - startupKajjiRssMiB) * 100) / 100,
        maxProcessCount: Math.max(
            0,
            ...valid.map((sample) => sample.processCount),
        ),
    }
}

function kibToMib(value: number): number {
    return Math.round((value / 1024) * 100) / 100
}

async function runBenchmark(
    fixture: ReturnType<typeof createFixture>,
    iteration: number,
): Promise<BenchmarkRun> {
    const fixtureRoot = dirname(fixture.repository)
    const home = createBenchmarkHome(fixtureRoot, iteration)
    const pidFile = join(fixtureRoot, `kajji-${iteration}.pid`)
    const terminal = await TerminalControl.make()
    const launchStartedAt = performance.now()
    const session = await terminal.launch({
        command: [
            "/bin/sh",
            "-c",
            'printf "%s\\n" "$$" > "$KAJJI_BENCHMARK_PID_FILE"; exec "$@"',
            "kajji-benchmark",
            process.execPath,
            "--preload",
            openTuiPreload,
            join(projectRoot, "src/index.tsx"),
        ],
        cwd: fixture.repository,
        host: "opentui",
        viewport,
        inheritEnv: true,
        env: {
            HOME: home,
            XDG_CONFIG_HOME: join(home, ".config"),
            XDG_STATE_HOME: join(home, ".local/state"),
            NODE_ENV: "production",
            KAJJI_BENCHMARK_PID_FILE: pidFile,
        },
    })
    const pid = await waitForPid(pidFile)
    const sampler = startMemorySampler(pid)

    try {
        await session.screen.waitForText("benchmark tip", { timeoutMs: 30_000 })
        await session.screen.waitForText("working-copy.ts", {
            timeoutMs: 30_000,
        })
        await session.screen.waitForText("benchmarkDetail0", {
            timeoutMs: 30_000,
        })
        await session.screen.waitForIdle({ quietForMs: 250, timeoutMs: 10_000 })
        const startupMs = performance.now() - launchStartedAt

        sampler.setPhase("fetch")
        const fetchStartedAt = performance.now()
        await session.keyboard.type("f")
        await session.screen.waitForIdle({ quietForMs: 500, timeoutMs: 15_000 })
        const fetchMs = performance.now() - fetchStartedAt

        sampler.setPhase("navigation")
        const navigationMs: number[] = []
        for (let cycle = 0; cycle < navigationCycles; cycle++) {
            const down = cycle % 2 === 0
            const startedAt = performance.now()
            await session.keyboard.type(down ? "j" : "k")
            await session.screen.waitUntil(
                (snapshot) =>
                    down
                        ? snapshot.text.includes("history.txt") &&
                          !snapshot.text.includes("benchmarkDetail0")
                        : snapshot.text.includes("benchmarkDetail0"),
                { timeoutMs: 10_000 },
            )
            await session.screen.waitForIdle({
                quietForMs: 100,
                timeoutMs: 5_000,
            })
            navigationMs.push(performance.now() - startedAt)
        }

        sampler.setPhase("settled")
        await Bun.sleep(1_000)

        sampler.setPhase("shutdown")
        const shutdownStartedAt = performance.now()
        await session.keyboard.type("q")
        const exit = await session.waitForExit({ timeoutMs: 5_000 })
        if (exit.reason !== "exited")
            throw new Error("Kajji did not exit after q")
        const shutdownMs = performance.now() - shutdownStartedAt

        return {
            startupMs,
            fetchMs,
            navigationMs,
            shutdownMs,
            memory: summarizeMemory(sampler.stop()),
        }
    } finally {
        sampler.stop()
        await session.stop()
        await terminal.close()
    }
}

function summarize(values: number[]): MetricSummary {
    const sorted = [...values].sort((a, b) => a - b)
    const percentile = (ratio: number) =>
        sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0
    return {
        median: percentile(0.5),
        p95: percentile(0.95),
        min: sorted[0] ?? 0,
        max: sorted.at(-1) ?? 0,
    }
}

function aggregate(runs: BenchmarkRun[]): Record<string, MetricSummary> {
    return {
        startupMs: summarize(runs.map((run) => run.startupMs)),
        fetchMs: summarize(runs.map((run) => run.fetchMs)),
        navigationMs: summarize(runs.flatMap((run) => run.navigationMs)),
        shutdownMs: summarize(runs.map((run) => run.shutdownMs)),
        peakKajjiRssMiB: summarize(
            runs.map((run) => run.memory.peakKajjiRssMiB),
        ),
        startupKajjiRssMiB: summarize(
            runs.map((run) => run.memory.startupKajjiRssMiB),
        ),
        peakTreeRssMiB: summarize(runs.map((run) => run.memory.peakTreeRssMiB)),
        endingKajjiRssMiB: summarize(
            runs.map((run) => run.memory.endingKajjiRssMiB),
        ),
        rssGrowthMiB: summarize(runs.map((run) => run.memory.rssGrowthMiB)),
    }
}

function metadata() {
    const revision = runCommand(projectRoot, [
        "jj",
        "log",
        "-r",
        "@",
        "--no-graph",
        "-T",
        "commit_id.short(12)",
    ])
    return {
        revision,
        dirty: runCommand(projectRoot, ["jj", "diff", "--summary"]).length > 0,
        bunVersion: Bun.version,
        jjVersion: runCommand(projectRoot, ["jj", "--version"]),
        platform: process.platform,
        arch: process.arch,
        fixtureCommits,
        navigationCycles,
        runs: runCount,
        viewport,
    }
}

function printSummary(report: BenchmarkReport, output: string) {
    console.log(`\nTUI benchmark: ${report.metadata.revision}`)
    for (const [name, result] of Object.entries(report.aggregate)) {
        const unit = name.endsWith("Ms") ? "ms" : " MiB"
        console.log(
            `${name.padEnd(22)} median ${result.median.toFixed(2)}${unit}, p95 ${result.p95.toFixed(2)}${unit}`,
        )
    }
    console.log(`\nReport: ${output}`)
}

const root = mkdtempSync(join(tmpdir(), "kajji-benchmark-"))
try {
    console.log(
        `Creating fixture (${fixtureCommits} commits) outside measured runs...`,
    )
    const fixture = createFixture(root, fixtureCommits)
    const runs: BenchmarkRun[] = []
    for (let iteration = 1; iteration <= runCount; iteration++) {
        process.stdout.write(`Run ${iteration}/${runCount}... `)
        const run = await runBenchmark(fixture, iteration)
        runs.push(run)
        console.log(
            `startup ${run.startupMs.toFixed(0)}ms, peak ${run.memory.peakKajjiRssMiB.toFixed(1)} MiB`,
        )
    }

    const createdAt = new Date().toISOString()
    const report: BenchmarkReport = {
        version: 1,
        createdAt,
        metadata: metadata(),
        runs,
        aggregate: aggregate(runs),
    }
    const output = resolve(
        values.output ??
            join(
                projectRoot,
                ".kajji-benchmarks",
                `${createdAt.replace(/[:.]/g, "-")}-${report.metadata.revision}.json`,
            ),
    )
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
    printSummary(report, output)
} finally {
    rmSync(root, { recursive: true, force: true })
}
