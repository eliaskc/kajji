import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { inspect } from "node:util"
import { writeHeapSnapshot } from "node:v8"
import { getRepoPath } from "../repo"
import { getCurrentVersion } from "./update"

const startedAt = new Date()
let loggingInitialized = false

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, "-")
}

export function getDiagnosticsDirectory() {
    const stateHome =
        process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
    return join(stateHome, "kajji", "log")
}

export function getLogPath() {
    return join(getDiagnosticsDirectory(), "kajji.log")
}

function formatLogValue(value: unknown) {
    return typeof value === "string"
        ? value
        : inspect(value, {
              depth: 5,
              breakLength: Number.POSITIVE_INFINITY,
          })
}

function appendLog(level: string, values: unknown[]) {
    try {
        mkdirSync(getDiagnosticsDirectory(), { recursive: true })
        appendFileSync(
            getLogPath(),
            `${new Date().toISOString()} level=${level} ${values.map(formatLogValue).join(" ")}\n`,
        )
    } catch {
        // Diagnostics must never prevent Kajji from running.
    }
}

export function diagnosticsLog(
    level: "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
) {
    if (!loggingInitialized) return
    appendLog(level, data ? [message, data] : [message])
}

export function initDiagnosticsLogging() {
    if (loggingInitialized) return
    loggingInitialized = true

    const originalWarn = console.warn.bind(console)
    const originalError = console.error.bind(console)
    console.warn = (...values: unknown[]) => {
        appendLog("warn", values)
        originalWarn(...values)
    }
    console.error = (...values: unknown[]) => {
        appendLog("error", values)
        originalError(...values)
    }

    process.on("uncaughtExceptionMonitor", (error, origin) => {
        appendLog("error", ["uncaught exception", origin, error])
    })
    process.on("unhandledRejection", (reason) => {
        appendLog("error", ["unhandled rejection", reason])
    })
    appendLog("info", ["Kajji started", getDebugInfo()])
}

function bytesToMiB(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDebugInfo() {
    const memory = process.memoryUsage()
    return {
        kajjiVersion: getCurrentVersion(),
        bunVersion: Bun.version,
        platform: `${process.platform} ${process.arch}`,
        startedAt: startedAt.toISOString(),
        uptime: `${Math.floor(process.uptime())}s`,
        repository: getRepoPath(),
        logPath: getLogPath(),
        rss: bytesToMiB(memory.rss),
        heapUsed: bytesToMiB(memory.heapUsed),
        heapTotal: bytesToMiB(memory.heapTotal),
        external: bytesToMiB(memory.external),
    }
}

export function writeDebugSnapshot() {
    const directory = getDiagnosticsDirectory()
    const path = join(directory, `debug-${stamp()}.json`)
    mkdirSync(directory, { recursive: true })
    writeFileSync(
        path,
        `${JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                ...getDebugInfo(),
                versions: process.versions,
                memoryUsage: process.memoryUsage(),
                environment: {
                    term: process.env.TERM,
                    colorTerm: process.env.COLORTERM,
                    shell: process.env.SHELL,
                    editor: process.env.VISUAL || process.env.EDITOR,
                },
            },
            null,
            2,
        )}\n`,
    )
    appendLog("info", ["Debug snapshot written", path])
    return path
}

export function writeMemorySnapshot() {
    const directory = getDiagnosticsDirectory()
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `heap-${process.pid}-${stamp()}.heapsnapshot`)
    const result = writeHeapSnapshot(path)
    appendLog("info", ["Heap snapshot written", result])
    return result
}
