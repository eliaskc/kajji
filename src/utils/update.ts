import { join } from "node:path"
import { $ } from "bun"
import { readState, writeState } from "./state"

const GITHUB_RELEASES_URL =
	"https://api.github.com/repos/eliaskc/kajji/releases/latest"
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

export type PackageManager =
	| "npm"
	| "bun"
	| "pnpm"
	| "yarn"
	| "curl"
	| "unknown"

export function getCurrentVersion(): string {
	return process.env.KAJJI_VERSION ?? "0.0.0"
}

export async function detectPackageManager(): Promise<PackageManager> {
	const execPath = process.execPath.toLowerCase()

	if (
		execPath.includes(join(".kajji", "bin")) ||
		execPath.includes(join(".local", "bin"))
	) {
		return "curl"
	}

	const checks: { name: PackageManager; command: () => Promise<string> }[] = [
		{ name: "bun", command: () => $`bun pm ls -g`.quiet().nothrow().text() },
		{
			name: "npm",
			command: () => $`npm list -g --depth=0`.quiet().nothrow().text(),
		},
		{
			name: "pnpm",
			command: () => $`pnpm list -g --depth=0`.quiet().nothrow().text(),
		},
		{
			name: "yarn",
			command: () => $`yarn global list`.quiet().nothrow().text(),
		},
	]

	checks.sort((a, b) => {
		const aMatches = execPath.includes(a.name)
		const bMatches = execPath.includes(b.name)
		if (aMatches && !bMatches) return -1
		if (!aMatches && bMatches) return 1
		return 0
	})

	for (const check of checks) {
		const output = await check.command()
		if (output.includes("kajji")) {
			return check.name
		}
	}

	return "unknown"
}

export function getUpdateCommand(
	pm: PackageManager,
	version: string,
): string | null {
	switch (pm) {
		case "npm":
			return `npm install -g kajji@${version}`
		case "bun":
			return `bun install -g kajji@${version}`
		case "pnpm":
			return `pnpm install -g kajji@${version}`
		case "yarn":
			return `yarn global add kajji@${version}`
		case "curl":
			return "curl -fsSL https://kajji.sh/install.sh | bash"
		default:
			return null
	}
}

export interface UpdateCallbacks {
	onChecking?: () => void
	onUpdateAvailable?: (info: {
		currentVersion: string
		latestVersion: string
	}) => void
	onUpdateStarted?: (info: {
		version: string
		packageManager: PackageManager
		command: string
	}) => void
	onUpdateFinished?: (info: {
		version: string
		packageManager: PackageManager
		command: string
		success: boolean
	}) => void
	onUpdateSkipped?: (reason: string) => void
	onError?: () => void
}

async function fetchLatestVersion(): Promise<string | null> {
	try {
		const response = await fetch(GITHUB_RELEASES_URL, {
			headers: {
				Accept: "application/vnd.github.v3+json",
				"User-Agent": "kajji-updater",
			},
		})
		if (!response.ok) return null
		const data = (await response.json()) as { tag_name: string }
		return data.tag_name.replace(/^v/, "")
	} catch {
		return null
	}
}

function compareVersions(a: string, b: string): number {
	const partsA = a.split(".").map(Number)
	const partsB = b.split(".").map(Number)
	for (let i = 0; i < 3; i++) {
		const numA = partsA[i] ?? 0
		const numB = partsB[i] ?? 0
		if (numA > numB) return 1
		if (numA < numB) return -1
	}
	return 0
}

function shouldSkipCheck(): boolean {
	const state = readState()
	if (!state.lastUpdateCheck) return false
	const lastCheck = new Date(state.lastUpdateCheck).getTime()
	return Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS
}

function updateLastCheckTime(): void {
	const state = readState()
	state.lastUpdateCheck = new Date().toISOString()
	writeState(state)
}

async function runUpdate(
	pm: PackageManager,
	version: string,
): Promise<boolean> {
	let result: { exitCode: number }

	switch (pm) {
		case "npm":
			result = await $`npm install -g kajji@${version}`.quiet().nothrow()
			break
		case "bun":
			result = await $`bun install -g kajji@${version}`.quiet().nothrow()
			break
		case "pnpm":
			result = await $`pnpm install -g kajji@${version}`.quiet().nothrow()
			break
		case "yarn":
			result = await $`yarn global add kajji@${version}`.quiet().nothrow()
			break
		case "curl":
			result = await $`curl -fsSL https://kajji.sh/install.sh | bash`
				.env({ ...process.env, VERSION: version })
				.quiet()
				.nothrow()
			break
		default:
			return false
	}

	return result.exitCode === 0
}

async function simulateUpdate(
	callbacks: UpdateCallbacks,
	success: boolean,
): Promise<void> {
	const currentVersion = getCurrentVersion()
	const latestVersion = "99.99.99"
	const packageManager: PackageManager = "bun"
	const command = getUpdateCommand(packageManager, latestVersion)
	if (!command) return

	callbacks.onChecking?.()
	await Bun.sleep(700)
	callbacks.onUpdateAvailable?.({ currentVersion, latestVersion })
	await Bun.sleep(500)
	callbacks.onUpdateStarted?.({
		version: latestVersion,
		packageManager,
		command,
	})
	await Bun.sleep(1800)
	callbacks.onUpdateFinished?.({
		version: latestVersion,
		packageManager,
		command,
		success,
	})
}

export function checkForUpdates(callbacks: UpdateCallbacks = {}): void {
	setTimeout(async () => {
		try {
			const { mockMode } = await import("../mock")
			if (mockMode === "update-success" || mockMode === "update-failed") {
				await simulateUpdate(callbacks, mockMode === "update-success")
				return
			}

			if (Bun.env.NODE_ENV === "development") return

			if (shouldSkipCheck()) {
				callbacks.onUpdateSkipped?.("checked recently")
				return
			}

			callbacks.onChecking?.()

			const currentVersion = getCurrentVersion()
			const latestVersion = await fetchLatestVersion()
			if (!latestVersion) {
				callbacks.onUpdateSkipped?.("latest version unavailable")
				return
			}

			updateLastCheckTime()

			if (compareVersions(latestVersion, currentVersion) <= 0) {
				callbacks.onUpdateSkipped?.("already up to date")
				return
			}

			callbacks.onUpdateAvailable?.({ currentVersion, latestVersion })

			const pm = await detectPackageManager()
			if (pm === "unknown") {
				callbacks.onUpdateSkipped?.("install method unknown")
				return
			}

			const command = getUpdateCommand(pm, latestVersion)
			if (!command) {
				callbacks.onUpdateSkipped?.("update command unavailable")
				return
			}

			callbacks.onUpdateStarted?.({
				version: latestVersion,
				packageManager: pm,
				command,
			})
			const success = await runUpdate(pm, latestVersion)
			callbacks.onUpdateFinished?.({
				version: latestVersion,
				packageManager: pm,
				command,
				success,
			})
		} catch {
			callbacks.onError?.()
			// Non-blocking, silent failure
		}
	}, 100)
}
