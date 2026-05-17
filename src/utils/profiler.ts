import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const PROFILE_ENABLED = process.env.KAJJI_PROFILE === "1"

const PROFILE_NAME = process.env.KAJJI_PROFILE_NAME || "default"
const PROFILE_MESSAGE = process.env.KAJJI_PROFILE_MESSAGE || ""
const PROFILE_DIR = join(process.cwd(), ".kajji-profiles")
const PROFILE_FILE = join(PROFILE_DIR, `${PROFILE_NAME}.log`)

let initialized = false
const startTime = performance.now()

function ensureDir() {
    if (initialized) return
    try {
        mkdirSync(PROFILE_DIR, { recursive: true })
        const header = [
            "# Kajji Profile",
            `# Name: ${PROFILE_NAME}`,
            PROFILE_MESSAGE ? `# Description: ${PROFILE_MESSAGE}` : null,
            `# Started: ${new Date().toISOString()}`,
            "# ",
            "",
        ]
            .filter(Boolean)
            .join("\n")
        writeFileSync(PROFILE_FILE, header)
        initialized = true
    } catch {
        // silent fail
    }
}

function formatTimestamp(): string {
    const elapsed = performance.now() - startTime
    const seconds = Math.floor(elapsed / 1000)
    const ms = Math.floor(elapsed % 1000)
    return `${seconds.toString().padStart(4, " ")}.${ms.toString().padStart(3, "0")}`
}

export function profileLog(label: string, data?: Record<string, unknown>) {
    if (!PROFILE_ENABLED) return

    ensureDir()

    const timestamp = formatTimestamp()
    const msg = data
        ? `[${timestamp}] ${label}: ${JSON.stringify(data)}`
        : `[${timestamp}] ${label}`

    try {
        appendFileSync(PROFILE_FILE, `${msg}\n`)
    } catch {
        // silent fail
    }

    // Also log to stderr for real-time visibility
    console.error(`[PROFILE] ${msg}`)
}

export function profile(label: string) {
    if (!PROFILE_ENABLED) return () => {}
    const start = performance.now()
    return (extra?: string) => {
        const ms = (performance.now() - start).toFixed(2)
        profileLog(label, { ms: Number(ms), ...(extra ? { extra } : {}) })
    }
}

/**
 * Simple profile log for inline messages (no timing wrapper)
 */
export function profileMsg(message: string) {
    if (!PROFILE_ENABLED) return
    profileLog(message)
}

let renderStart: number | null = null
let renderCount = 0

export function markRenderStart(component: string) {
    if (!PROFILE_ENABLED) return
    renderStart = performance.now()
    renderCount++
    profileLog(`render-start:${component}`, { renderCount })
}

export function markRenderEnd(component: string, lineCount?: number) {
    if (!PROFILE_ENABLED || renderStart === null) return
    const ms = performance.now() - renderStart
    profileLog(`render-end:${component}`, {
        ms: Number(ms.toFixed(2)),
        renderCount,
        ...(lineCount !== undefined ? { lines: lineCount } : {}),
    })
    renderStart = null
}
