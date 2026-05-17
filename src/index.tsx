// biome-ignore lint/suspicious/noExplicitAny: startup profiling
const g = globalThis as any
const _t0 = Bun.nanoseconds()
g.__STARTUP_T0 = _t0
g.__STARTUP_TRACE = process.env.KAJJI_STARTUP_TRACE === "1"
function _trace(label: string) {
    if (!g.__STARTUP_TRACE) return
    const ms = (Bun.nanoseconds() - _t0) / 1e6
    console.error(`[startup] ${ms.toFixed(1).padStart(7)}ms  ${label}`)
}
_trace("index.tsx top")

import { existsSync } from "node:fs"
import { resolve } from "node:path"

const CLI_COMMANDS = ["changes", "comment", "help", "uninstall"]
const CLI_FLAGS = ["--help", "-h", "--version", "-V"]

const args = process.argv.slice(2)
const firstArg = args[0]

if (
    firstArg &&
    (CLI_COMMANDS.includes(firstArg) || CLI_FLAGS.includes(firstArg))
) {
    const { runCli } = await import("./cli/index.js")
    const normalizedArgs = firstArg === "-V" ? ["--version"] : args
    await runCli(normalizedArgs)
    process.exit(0)
}

if (
    firstArg &&
    !firstArg.startsWith("-") &&
    !firstArg.startsWith("/") &&
    !existsSync(resolve(firstArg))
) {
    console.error(`Unknown command: ${firstArg}`)
    console.error("Run 'kajji --help' for available commands")
    process.exit(1)
}

_trace("before import tui")
const { runTui } = await import("./tui.js")
_trace("after import tui")
await runTui(args)
