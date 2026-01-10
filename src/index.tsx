import { ConsolePosition } from "@opentui/core"
import { extend, render, useRenderer } from "@opentui/solid"
import { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer"
import { Show, createSignal } from "solid-js"
import { App } from "./App"
import { StartupScreen } from "./components/StartupScreen"
import { ThemeProvider } from "./context/theme"
import { initHighlighter } from "./diff"
import { getRepoPath, setRepoPath } from "./repo"
import { checkRepoStatus, initJjGitRepo, initJjRepo } from "./utils/repo-check"
import { getRecentRepos } from "./utils/state"

// Parse CLI args - first positional arg is repo path
const args = process.argv.slice(2)
if (args[0] && !args[0].startsWith("-")) {
	setRepoPath(args[0])
}

extend({ "ghostty-terminal": GhosttyTerminalRenderable })

initHighlighter()

function Root() {
	const renderer = useRenderer()
	const initialStatus = checkRepoStatus(getRepoPath())
	const [isJjRepo, setIsJjRepo] = createSignal(initialStatus.isJjRepo)
	const [hasGitRepo] = createSignal(initialStatus.hasGitRepo)
	const [initError, setInitError] = createSignal<string | null>(null)

	const handleSelectRepo = (path: string) => {
		setRepoPath(path)
		const status = checkRepoStatus(path)
		if (status.isJjRepo) {
			setIsJjRepo(true)
		}
	}

	const handleInitJj = async () => {
		setInitError(null)
		const result = await initJjRepo(getRepoPath())
		if (result.success) {
			setIsJjRepo(true)
		} else {
			setInitError(result.error ?? "Failed to initialize")
		}
	}

	const handleInitJjGit = async (colocate: boolean) => {
		setInitError(null)
		const result = await initJjGitRepo(getRepoPath(), { colocate })
		if (result.success) {
			setIsJjRepo(true)
		} else {
			setInitError(result.error ?? "Failed to initialize")
		}
	}

	const handleQuit = () => {
		renderer.destroy()
		process.exit(0)
	}

	return (
		<Show
			when={isJjRepo()}
			fallback={
				<ThemeProvider>
					<StartupScreen
						hasGitRepo={hasGitRepo()}
						recentRepos={getRecentRepos()}
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
