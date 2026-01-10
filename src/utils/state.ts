import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const MAX_RECENT_REPOS = 10

export interface RecentRepo {
	path: string
	lastOpened: string // ISO date string
}

export interface AppState {
	recentRepos: RecentRepo[]
	lastUpdateCheck?: string
	dismissedVersion?: string | null
}

function getStatePath(): string {
	return join(homedir(), ".config", "kajji", "state.json")
}

function ensureStateDir(): void {
	const dir = dirname(getStatePath())
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
}

export function readState(): AppState {
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
	ensureStateDir()
	const statePath = getStatePath()
	writeFileSync(statePath, JSON.stringify(state, null, 2))
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
