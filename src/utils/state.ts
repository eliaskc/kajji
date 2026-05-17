import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { writeFileAtomic } from "./atomic-write"

const MAX_RECENT_REPOS = 10

export interface RecentRepo {
    path: string
    lastOpened: string // ISO date string
}

export interface AppState {
    recentRepos: RecentRepo[]
    lastUpdateCheck?: string
    lastSeenVersion?: string
    dismissedVersion?: string | null
    terminalBackground?: string
}

const CONFIG_DIR = join(homedir(), ".config", "kajji")
const STATE_DIR = join(homedir(), ".local", "state", "kajji")
const OLD_STATE_PATH = join(CONFIG_DIR, "state.json")

function getStatePath(): string {
    return join(STATE_DIR, "state.json")
}

function getConfigPath(): string {
    return join(CONFIG_DIR, "config.json")
}

let migrationAttempted = false

export function migrateStateIfNeeded(): void {
    if (migrationAttempted) return
    migrationAttempted = true

    if (!existsSync(OLD_STATE_PATH)) return

    try {
        const oldContent = readFileSync(OLD_STATE_PATH, "utf-8")
        const oldState = JSON.parse(oldContent) as AppState & {
            whatsNewDisabled?: boolean
        }

        const newStatePath = getStatePath()
        const newConfigPath = getConfigPath()

        let stateWritten = false
        let configWritten = false

        if (!existsSync(newStatePath)) {
            const nextState: AppState = {
                recentRepos: oldState.recentRepos ?? [],
                lastUpdateCheck: oldState.lastUpdateCheck,
                lastSeenVersion: oldState.lastSeenVersion,
                dismissedVersion: oldState.dismissedVersion,
            }
            writeFileAtomic(newStatePath, JSON.stringify(nextState, null, 2))
            stateWritten = true
        }

        if (
            oldState.whatsNewDisabled !== undefined &&
            !existsSync(newConfigPath)
        ) {
            const nextConfig = { whatsNewDisabled: oldState.whatsNewDisabled }
            writeFileAtomic(newConfigPath, JSON.stringify(nextConfig, null, 2))
            configWritten = true
        }

        const canFinalize =
            (existsSync(newStatePath) || stateWritten) &&
            (oldState.whatsNewDisabled === undefined ||
                existsSync(newConfigPath) ||
                configWritten)

        if (canFinalize) {
            const backupPath = `${OLD_STATE_PATH}.bak`
            if (!existsSync(backupPath)) {
                writeFileAtomic(backupPath, oldContent)
            }
            unlinkSync(OLD_STATE_PATH)
        }
    } catch {
        // Keep old state if migration fails
    }
}

export function readState(): AppState {
    migrateStateIfNeeded()
    const statePath = getStatePath()
    if (!existsSync(statePath)) {
        return { recentRepos: [] }
    }
    try {
        const content = readFileSync(statePath, "utf-8")
        return JSON.parse(content) as AppState
    } catch {
        return { recentRepos: [] }
    }
}

export function writeState(state: AppState): void {
    migrateStateIfNeeded()
    const statePath = getStatePath()
    writeFileAtomic(statePath, JSON.stringify(state, null, 2))
}

export function addRecentRepo(repoPath: string): void {
    const state = readState()
    const now = new Date().toISOString()

    // Remove existing entry for this path if present
    state.recentRepos = state.recentRepos.filter((r) => r.path !== repoPath)

    // Add to front
    state.recentRepos.unshift({ path: repoPath, lastOpened: now })

    // Trim to max
    if (state.recentRepos.length > MAX_RECENT_REPOS) {
        state.recentRepos = state.recentRepos.slice(0, MAX_RECENT_REPOS)
    }

    writeState(state)
}

export function getRecentRepos(): RecentRepo[] {
    const state = readState()
    // Filter out repos that no longer exist (have .jj directory)
    return state.recentRepos.filter((r) => existsSync(join(r.path, ".jj")))
}

export function formatRelativeTime(isoDate: string): string {
    const date = new Date(isoDate)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays === 1) return "yesterday"
    if (diffDays < 7) return `${diffDays}d ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
    return date.toLocaleDateString()
}

export function getCachedTerminalBackground(): string | null {
    const background = readState().terminalBackground
    return typeof background === "string" ? background : null
}

export function cacheTerminalBackground(background: string): void {
    const state = readState()
    if (state.terminalBackground === background) return
    writeState({
        ...state,
        terminalBackground: background,
    })
}
