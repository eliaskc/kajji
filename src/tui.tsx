import { ConsolePosition } from "@opentui/core"
import { extend, render, useRenderer } from "@opentui/solid"
import { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer"
import { Show, createSignal } from "solid-js"
import { App } from "./App"
import { jjWorkspaceUpdateStale } from "./commander/operations"
import { ErrorScreen } from "./components/ErrorScreen"
import { StartupScreen } from "./components/StartupScreen"
import { WaveScreen } from "./components/WaveScreen"
import { WhatsNewScreen } from "./components/WhatsNewScreen"
import { ThemeProvider } from "./context/theme"
import { initHighlighter } from "./diff"
import { type MockMode, mockMode, setMockMode } from "./mock"
import { getRepoPath, setRepoPath } from "./repo"
import { getChangesSince, parseChangelog } from "./utils/changelog"
import { checkRepoStatus, initJjGitRepo, initJjRepo } from "./utils/repo-check"
import { getRecentRepos } from "./utils/state"

import changelogContent from "../CHANGELOG.md" with { type: "text" }

// Mock error messages for testing
const MOCK_ERRORS = {
	"error-stale": `jj log failed: Error: The working copy is stale (not updated since operation abc123).
Hint: Run \`jj workspace update-stale\` to update it.
For more information, see https://martinvonz.github.io/jj/latest/working-copy/`,
}

extend({ "ghostty-terminal": GhosttyTerminalRenderable })

initHighlighter()

export async function runTui(args: string[]): Promise<void> {
	const isDev = Bun.env.NODE_ENV === "development"
	let mockWhatsNewVersion: string | null = null

	for (const arg of args) {
		if (isDev && arg.startsWith("--mock=")) {
			const value = arg.slice(7)
			// Handle whats-new:version format
			if (value.startsWith("whats-new")) {
				setMockMode("whats-new")
				const colonIndex = value.indexOf(":")
				if (colonIndex !== -1) {
					mockWhatsNewVersion = value.slice(colonIndex + 1)
				}
			} else if (
				[
					"error-stale",
					"startup-no-vcs",
					"startup-git",
					"update-success",
					"update-failed",
					"logo",
					"wave",
				].includes(value)
			) {
				setMockMode(value as MockMode)
			}
		} else if (!arg.startsWith("-")) {
			if (mockMode === "whats-new" && !mockWhatsNewVersion) {
				const isVersion = /^\d+\.\d+\.\d+$/.test(arg)
				if (isVersion) {
					mockWhatsNewVersion = arg
					continue
				}
			}
			setRepoPath(arg)
		}
	}

	function Root() {
		const renderer = useRenderer()
		const initialStatus = checkRepoStatus(getRepoPath())
		if (initialStatus.repoPath !== getRepoPath()) {
			setRepoPath(initialStatus.repoPath)
		}
		const [isJjRepo, setIsJjRepo] = createSignal(
			mockMode
				? mockMode !== "startup-no-vcs" && mockMode !== "startup-git"
				: initialStatus.isJjRepo,
		)
		const [hasGitRepo] = createSignal(
			mockMode === "startup-git" ? true : initialStatus.hasGitRepo,
		)
		const [startupError, setStartupError] = createSignal<string | null>(
			mockMode ? null : initialStatus.startupError,
		)

		const handleSelectRepo = (path: string) => {
			setRepoPath(path)
			const status = checkRepoStatus(path)
			if (status.repoPath !== path) {
				setRepoPath(status.repoPath)
			}
			if (status.isJjRepo) {
				setIsJjRepo(true)
			}
		}

		const handleInitJj = async () => {
			const result = await initJjRepo(getRepoPath())
			if (result.success) {
				setIsJjRepo(true)
			}
		}

		const handleInitJjGit = async (colocate: boolean) => {
			const result = await initJjGitRepo(getRepoPath(), { colocate })
			if (result.success) {
				setIsJjRepo(true)
			}
		}

		const handleQuit = () => {
			renderer.destroy()
			process.exit(0)
		}

		// Mock wave/logo screen
		if (mockMode === "logo" || mockMode === "wave") {
			return (
				<ThemeProvider>
					<WaveScreen showLogo={mockMode === "logo"} />
				</ThemeProvider>
			)
		}

		// Mock what's new screen
		if (mockMode === "whats-new") {
			const allBlocks = parseChangelog(changelogContent)
			const lastSeenVersion =
				mockWhatsNewVersion ?? allBlocks[1]?.version ?? "0.0.0"
			const newChanges = getChangesSince(allBlocks, lastSeenVersion)
			return (
				<ThemeProvider>
					<WhatsNewScreen
						changes={newChanges.length > 0 ? newChanges : allBlocks.slice(0, 1)}
						onClose={handleQuit}
						onDisable={handleQuit}
					/>
				</ThemeProvider>
			)
		}

		// Mock error screen
		if (mockMode === "error-stale") {
			const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
			return (
				<ThemeProvider>
					<ErrorScreen
						error={MOCK_ERRORS["error-stale"]}
						onRetry={async () => {
							await sleep(1000)
							// In real usage, parent would update error prop or unmount
						}}
						onFix={async () => {
							await sleep(1000)
							// In real usage, parent would update error prop or unmount
						}}
						onQuit={handleQuit}
					/>
				</ThemeProvider>
			)
		}

		const handleRetryStartup = async () => {
			const status = checkRepoStatus(getRepoPath())
			if (status.repoPath !== getRepoPath()) {
				setRepoPath(status.repoPath)
			}
			setStartupError(status.startupError)
			if (!status.startupError) {
				setIsJjRepo(status.isJjRepo)
			}
		}

		const handleFixStartup = async () => {
			const result = await jjWorkspaceUpdateStale()
			if (result.success) {
				await handleRetryStartup()
			}
		}

		// Show error screen for critical startup errors (like stale working copy)
		const currentStartupError = startupError()
		if (currentStartupError) {
			return (
				<ThemeProvider>
					<ErrorScreen
						error={currentStartupError}
						onRetry={handleRetryStartup}
						onFix={handleFixStartup}
						onQuit={handleQuit}
					/>
				</ThemeProvider>
			)
		}

		return (
			<Show
				when={isJjRepo()}
				fallback={
					<ThemeProvider>
						<StartupScreen
							hasGitRepo={hasGitRepo()}
							recentRepos={mockMode ? [] : getRecentRepos()}
							onSelectRepo={handleSelectRepo}
							onInitJj={handleInitJj}
							onInitJjGit={handleInitJjGit}
							onQuit={handleQuit}
						/>
					</ThemeProvider>
				}
			>
				<App />
			</Show>
		)
	}

	render(() => <Root />, {
		consoleOptions: {
			position: ConsolePosition.BOTTOM,
			maxStoredLogs: 1000,
			sizePercent: 40,
		},
	})
}
