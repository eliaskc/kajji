// Local single-run adapter: only launch argv and import paths differ from scripts/perf/run.ts.
import {
    constants,
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
} from "node:fs"
import { delimiter, join } from "node:path"
import { TerminalControl } from "@kitlangton/terminal-control"
import type { Frame, Session } from "@kitlangton/terminal-control"
import { burstMetrics, frames, position, ready, readinessProblem, startupFrames } from "../scripts/perf/analysis"
import { executableIdentity } from "../scripts/perf/compatibility"
import { command, controlledConfig, createHome, hash } from "../scripts/perf/fixture"
import { sampleResources } from "../scripts/perf/resources"
import type {
    Burst,
    FixtureManifest,
    FrameEvent,
    Run,
    Scenario,
    Settings,
    State,
    TraceEvent,
    VisibleSample,
} from "../scripts/perf/types"

export class BenchmarkFailure extends Error {
    constructor(
        error: unknown,
        readonly diagnostic: object,
    ) {
        super(String(error))
    }
}

const now = () => performance.timeOrigin + performance.now()
const captureOptions = { settleMs: 0, deadlineMs: 0, allowIncomplete: true }
export const firstContentSampleMs = 16
export const startupReadySampleMs = 32
const sleepUntil = async (due: number) => {
    while (now() < due) await Bun.sleep(Math.max(1, due - now()))
}

function panelHash(frame: Frame, state: State, scenario: Scenario): string {
    const x = Number(state[`${scenario}X`])
    const y = Number(state[`${scenario}Y`])
    const width = Number(state[`${scenario}Width`])
    const height = Number(state[`${scenario}Height`])
    if (!(width > 0 && height > 0)) throw new Error(`Missing ${scenario} viewport`)
    // Include cell styles: moving selection can change only its background.
    return hash(
        JSON.stringify(
            frame.cells.filter(
                (cell) => cell.x >= x && cell.x < x + width && cell.y >= y && cell.y < y + height,
            ),
        ),
    )
}

function traceReader(path: string) {
    let textLength = 0
    const events: TraceEvent[] = []
    return {
        events,
        read() {
            if (!existsSync(path)) return events
            const text = readFileSync(path, "utf8")
            const end = text.lastIndexOf("\n") + 1
            if (end > textLength) {
                for (const line of text.slice(textLength, end).trim().split("\n"))
                    events.push(JSON.parse(line))
                textLength = end
            }
            return events
        },
        latest() {
            return frames(this.read()).at(-1)
        },
    }
}

async function waitFrame(
    reader: ReturnType<typeof traceReader>,
    predicate: (event: FrameEvent) => boolean,
    timeoutMs = 60000,
): Promise<FrameEvent> {
    const deadline = now() + timeoutMs
    while (now() < deadline) {
        const latest = reader.latest()
        if (latest?.state.loadError || latest?.state.diffError)
            throw new Error("Application reported a loading error")
        if (latest && predicate(latest)) return latest
        await Bun.sleep(10)
    }
    const state = reader.latest()?.state
    throw new Error(
        `Timed out waiting for output state. ${readinessProblem(state)}. State: ${JSON.stringify(state)}`,
    )
}

async function runBurst(
    session: Session,
    reader: ReturnType<typeof traceReader>,
    scenario: Scenario,
    settings: Settings,
    direction: "down" | "up",
): Promise<Burst> {
    const initial = reader.latest()!
    const startPosition = position(initial.state, scenario)
    const exactSteps = scenario !== "diff" || settings.diffInput === "line"
    const startCaptureRequested = now()
    const startScreen = await session.screen.capture(captureOptions)
    const visible: VisibleSample[] = [
        {
            requested: startCaptureRequested,
            at: now(),
            hash: panelHash(startScreen.frame, initial.state, scenario),
        },
    ]
    let observing = true
    let observerError: unknown
    const observe = async () => {
        while (observing) {
            const requested = now()
            const snapshot = await session.screen.capture(captureOptions)
            visible.push({
                requested,
                at: now(),
                hash: panelHash(snapshot.frame, initial.state, scenario),
            })
            await sleepUntil(requested + settings.sampleMs)
        }
    }
    const observation =
        settings.sampleMs > 0
            ? observe().catch((error) => {
                  observerError = error
              })
            : Promise.resolve()
    const startedAt = now() + 30
    const inputs: Burst["inputs"] = []
    const sends: Promise<void>[] = []
    let final: FrameEvent
    try {
        for (let index = 0; index < settings.steps; index++) {
            const due = startedAt + index * settings.intervalMs
            await sleepUntil(due)
            const input = { due, sent: now(), ack: 0, direction }
            inputs.push(input)
            const down = direction === "down"
            // Do not wait for a screen, a render, or an input acknowledgement.
            // Each input has an absolute deadline; report any driver lateness.
            let sent: Promise<void>
            if (scenario === "diff" && settings.diffInput === "page") {
                sent = session.keyboard.press(down ? "Control+D" : "Control+U")
            } else if (scenario === "diff" && settings.diffInput === "wheel") {
                const x =
                    Number(initial.state.diffX) +
                    Math.floor(Number(initial.state.diffWidth) / 2) +
                    1
                const y =
                    Number(initial.state.diffY) +
                    Math.floor(Number(initial.state.diffHeight) / 2) +
                    1
                sent = session.keyboard.write(Buffer.from(`\x1b[<${down ? 65 : 64};${x};${y}M`))
            } else {
                sent = session.keyboard.type(down ? "j" : "k")
            }
            sends.push(
                sent.then(() => {
                    input.ack = now()
                }),
            )
        }
        await Promise.all(sends)
        const lastSent = inputs.at(-1)!.sent
        const expected = startPosition + (direction === "down" ? settings.steps : -settings.steps)
        if (exactSteps) {
            final = await waitFrame(
                reader,
                (frame) =>
                    frame.at >= lastSent &&
                    position(frame.state, scenario) === expected &&
                    ready(frame.state),
                30000,
            )
        } else {
            // Wheel acceleration and page clamping do not have a fixed step
            // size. Require movement, then use a documented quiet window only
            // to establish completion, never as a latency measurement.
            await waitFrame(
                reader,
                (frame) =>
                    frame.at >= lastSent &&
                    position(frame.state, scenario) !== startPosition &&
                    ready(frame.state),
                30000,
            )
            let lastChangedAt = now()
            let lastPosition = position(reader.latest()!.state, scenario)
            const deadline = now() + 30000
            while (now() - lastChangedAt < 400) {
                if (now() > deadline) throw new Error("Scroll did not stop")
                await Bun.sleep(20)
                const p = position(reader.latest()!.state, scenario)
                if (p !== lastPosition) {
                    lastPosition = p
                    lastChangedAt = now()
                }
            }
            final = frames(reader.read()).findLast(
                (frame) =>
                    frame.at >= lastSent &&
                    position(frame.state, scenario) === lastPosition &&
                    ready(frame.state),
            )!
        }
        // Capture the final panel independently of the in-app observer.
        const requested = now()
        const snapshot = await session.screen.capture(captureOptions)
        visible.push({
            requested,
            at: now(),
            hash: panelHash(snapshot.frame, initial.state, scenario),
        })
    } catch (error) {
        throw new BenchmarkFailure(error, {
            scenario,
            direction,
            startedAt,
            startPosition,
            inputs,
            visible,
        })
    } finally {
        observing = false
        await observation
        await Promise.allSettled(sends)
    }
    if (observerError) throw observerError
    const endPosition = position(final.state, scenario)
    // First ready output frame at the final position, not the polling time.
    const completion = frames(reader.read()).find(
        (frame) =>
            frame.at >= inputs.at(-1)!.sent &&
            position(frame.state, scenario) === endPosition &&
            ready(frame.state),
    )!
    const burst: Burst = {
        sampleMs: settings.sampleMs,
        direction,
        startedAt,
        endedAt: completion.at,
        startPosition,
        endPosition,
        inputs,
        visible: visible.sort((a, b) => a.at - b.at),
        metrics: {},
    }
    try {
        burst.metrics = burstMetrics(burst, reader.read(), scenario, exactSteps)
        if (burst.metrics.schedulerLatenessMaxMs! > Math.max(20, settings.intervalMs)) {
            throw new Error(
                `Input driver missed its schedule (${burst.metrics.schedulerLatenessMaxMs!.toFixed(1)} ms late). Close other workloads or lower the rate; result rejected.`,
            )
        }
    } catch (error) {
        throw new BenchmarkFailure(error, burst)
    }
    return burst
}

export async function runScenario(
    projectRoot: string,
    fixtureRoot: string,
    manifest: FixtureManifest,
    runRoot: string,
    scenario: Scenario,
    iteration: number,
    settings: Settings,
    bun: string,
    tools = { jj: executableIdentity("jj").path, git: executableIdentity("git").path },
): Promise<Run> {
    mkdirSync(runRoot, { recursive: true, mode: 0o700 })
    const repository = join(runRoot, "repo")
    // Fresh independent repository per process. Copy-on-write where supported;
    // never hard links. Preparation is outside the timed interval.
    cpSync(join(fixtureRoot, "repo"), repository, {
        recursive: true,
        preserveTimestamps: true,
        mode: constants.COPYFILE_FICLONE,
    })
    const env = createHome(join(runRoot, "home"), {
        ...controlledConfig,
        diff: { ...controlledConfig.diff, layout: settings.layout, wrap: settings.wrap },
    })
    // Pin the executables whose identities are recorded, rather than resolving
    // a different jj/Git after changing HOME or entering the copied repository.
    const bin = join(runRoot, "bin")
    mkdirSync(bin)
    symlinkSync(tools.jj, join(bin, "jj"))
    symlinkSync(tools.git, join(bin, "git"))
    env.PATH = `${bin}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`
    // Refresh filesystem bookkeeping after copying, without changing content.
    // Otherwise copy-induced timestamp changes would dominate startup cost.
    command(repository, ["jj", "status"], env)
    const op = command(
        repository,
        ["jj", "--ignore-working-copy", "op", "log", "--limit", "1", "--no-graph", "-T", "id"],
        env,
    )
    if (op !== manifest.operation)
        throw new Error("Fixture operation changed; prepare a new fixture")
    const tracePath = join(runRoot, "trace.jsonl")
    const reader = traceReader(tracePath)
    const terminal = await TerminalControl.make()
    let session: Session | undefined
    let sampler: ReturnType<typeof sampleResources> | undefined
    try {
        const launchStartedAt = now()
        session = await terminal.launch({
            command: [
                "/bin/sh",
                "-c",
                'printf "%s" "$$" > "$KAJJI_BENCHMARK_PID"; exec "$@"',
                "kajji-benchmark",
                bun, // This local adapter receives a compiled Kajji executable.
                repository,
            ],
            cwd: runRoot,
            host: "opentui",
            viewport: { cols: settings.cols, rows: settings.rows },
            inheritEnv: false,
            env: {
                ...env,
                TERM: "xterm-256color",
                COLORTERM: "truecolor",
                LANG: "en_US.UTF-8",
                TZ: "UTC",
                KAJJI_BENCHMARK_TRACE: tracePath,
                KAJJI_BENCHMARK_PID: join(runRoot, "pid"),
            },
        })
        const launchReturnedMs = now() - launchStartedAt
        let firstContentObservedMs: number | undefined
        let previousCaptureAt = launchStartedAt
        let firstContentLowerMs = 0
        let fullUi: FrameEvent | undefined
        let content: FrameEvent | undefined
        let contentReadyObservedUpperMs: number | undefined
        let fullUiObserved = false
        const startupDeadline = now() + 90000
        while (now() < startupDeadline) {
            if (!sampler && existsSync(join(runRoot, "pid"))) {
                const pid = Number(readFileSync(join(runRoot, "pid"), "utf8"))
                if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid benchmark PID")
                sampler = sampleResources(pid)
            }
            const requested = now()
            const screen = await session.screen.capture(captureOptions)
            const observed = now()
            if (firstContentObservedMs === undefined && screen.text.trim()) {
                firstContentObservedMs = observed - launchStartedAt
                firstContentLowerMs = previousCaptureAt - launchStartedAt
            }
            previousCaptureAt = requested
            const milestones = startupFrames(reader.read(), manifest.workingCopy)
            content = milestones.content
            fullUi = milestones.highlighted
            const latest = reader.latest()
            if (latest?.state.loadError || latest?.state.diffError)
                throw new Error("Application failed to load fixture")
            const headingsVisible =
                screen.text.includes("Revisions") &&
                screen.text.includes("Bookmarks") &&
                screen.text.includes("Detail")
            if (content && headingsVisible && contentReadyObservedUpperMs === undefined) {
                contentReadyObservedUpperMs = observed - launchStartedAt
            }
            if (fullUi && headingsVisible) {
                fullUiObserved = true
                break
            }
            // First-content timing needs a tighter observation interval than
            // steady-state screen validation, especially with sparse sampling.
            await sleepUntil(
                requested +
                    (firstContentObservedMs === undefined
                        ? firstContentSampleMs
                        : settings.sampleMs || startupReadySampleMs),
            )
        }
        if (
            !content ||
            !fullUi ||
            !fullUiObserved ||
            firstContentObservedMs === undefined ||
            contentReadyObservedUpperMs === undefined
        )
            throw new Error(`Startup did not complete. ${readinessProblem(reader.latest()?.state)}`)
        if (fullUi.state.diffRevision !== manifest.workingCopy) {
            throw new Error("Startup selected a different revision from the fixture working copy")
        }
        const startup = {
            initialLogCount: Number(fullUi.state.logCount),
            initialBookmarkCount: Number(fullUi.state.bookmarkCount),
            launchReturnedMs,
            firstContentObservedMs,
            firstContentLowerMs,
            firstContentUncertaintyMs: firstContentObservedMs - firstContentLowerMs,
            firstOutputFrameMs: frames(reader.read())[0]!.at - launchStartedAt,
            logLoadedOutputMs:
                frames(reader.read()).find((frame) => frame.state.logReady)!.at - launchStartedAt,
            bookmarksLoadedOutputMs:
                frames(reader.read()).find((frame) => frame.state.bookmarksReady)!.at -
                launchStartedAt,
            diffLoadedOutputMs:
                frames(reader.read()).find((frame) => frame.state.diffReady)!.at - launchStartedAt,
            contentReadyOutputMs: content.at - launchStartedAt,
            highlightedReadyOutputMs: fullUi.at - launchStartedAt,
            highlightingAfterContentMs: fullUi.at - content.at,
            contentReadyObservedUpperMs,
            highlightedReadyObservedUpperMs: now() - launchStartedAt,
        }
        await session.keyboard.type(scenario === "diff" ? "3" : scenario === "log" ? "1" : "2")
        await waitFrame(
            reader,
            (frame) =>
                ready(frame.state) &&
                String(frame.state.context).startsWith(
                    scenario === "diff"
                        ? "detail"
                        : scenario === "log"
                          ? "log.revisions"
                          : "refs.bookmarks",
                ),
        )
        const bursts: Burst[] = []
        for (let pass = 0; pass < settings.passes; pass++) {
            for (const direction of ["down", "up"] as const) {
                bursts.push(await runBurst(session, reader, scenario, settings, direction))
            }
        }
        await session.keyboard.type("q")
        const exit = await session.waitForExit({ timeoutMs: 10000 })
        if (exit.reason !== "exited" || !exit.exit.success)
            throw new Error("Kajji did not exit successfully")
        const trace = reader.read()
        const resources = trace.filter((event) => event.kind === "resource")
        if (!resources.length) throw new Error("No resource samples")
        const first = resources.findLast((sample) => sample.at <= fullUi.at) ?? resources[0]!
        const last = resources.at(-1)!
        const tree = await sampler?.stop()
        if (!tree?.samples.length) throw new Error("No process-tree samples")
        const metrics = {
            peakTreeRssMiB: Math.max(...tree.samples.map((sample) => sample.treeRssMiB)),
            maxProcessCount: Math.max(...tree.samples.map((sample) => sample.processCount)),
            resourceSampleErrors: tree.errors,
            resourceSampleCostMaxMs: Math.max(...tree.samples.map((sample) => sample.sampleCostMs)),
            observerFlushMaxMs: Math.max(...resources.map((sample) => sample.observerFlushMs)),
            observerWriteMaxMs: Math.max(...resources.map((sample) => sample.observerWriteMs)),
            peakRssMiB: Math.max(...resources.map((sample) => sample.rssMiB)),
            endingRssMiB: last.rssMiB,
            rssGrowthMiB: last.rssMiB - first.rssMiB,
            cpuMs: (last.cpu.user + last.cpu.system) / 1000,
        }
        return { scenario, iteration, startup, bursts, trace, processTree: tree.samples, metrics }
    } catch (error) {
        throw new BenchmarkFailure(error, {
            scenario,
            trace: reader.read(),
            processTree: sampler?.samples,
            burst: error instanceof BenchmarkFailure ? error.diagnostic : undefined,
        })
    } finally {
        try {
            await session?.stop()
        } finally {
            await sampler?.stop()
            await terminal.close()
            rmSync(runRoot, { recursive: true, force: true })
        }
    }
}
