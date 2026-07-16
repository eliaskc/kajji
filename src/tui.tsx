// biome-ignore lint/suspicious/noExplicitAny: startup profiling
const g = globalThis as any
function _trace(label: string) {
    if (!g.__STARTUP_TRACE) return
    const ms = (Bun.nanoseconds() - g.__STARTUP_T0) / 1e6
    console.error(`[startup] ${ms.toFixed(1).padStart(7)}ms  ${label}`)
}
_trace("tui.tsx top (imports starting)")

import { ConsolePosition } from "@opentui/core"
import { extend, render, useRenderer } from "@opentui/solid"
import { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer"
import { Show, createSignal } from "solid-js"
import { App } from "./App"
import { makeApplicationClient } from "./application/client"
import { ErrorScreen } from "./components/ErrorScreen"
import { StartupScreen } from "./components/StartupScreen"
import { WaveScreen } from "./components/WaveScreen"
import { WhatsNewScreen } from "./components/WhatsNewScreen"
import { ThemeProvider } from "./context/theme"
import { initHighlighter } from "./diff"
import { type MockMode, mockMode, setMockMode } from "./mock"
import { disableOpenTuiSelection } from "./opentui-selection"
import { getRepoPath, setRepoPath } from "./repo"
import { getChangesSince, parseChangelog } from "./utils/changelog"
import { getRecentRepos } from "./utils/state"

import changelogContent from "../CHANGELOG.md" with { type: "text" }

_trace("tui.tsx imports done")

// Mock error messages for testing
const MOCK_ERRORS = {
    "error-stale": `jj log failed: Error: The working copy is stale (not updated since operation abc123).
Hint: Run \`jj workspace update-stale\` to update it.
For more information, see https://martinvonz.github.io/jj/latest/working-copy/`,
}

_trace("before extend()")
disableOpenTuiSelection()
extend({ "ghostty-terminal": GhosttyTerminalRenderable })
_trace("after extend()")

_trace("before initHighlighter()")
initHighlighter()
_trace("after initHighlighter()")

export async function runTui(args: string[]): Promise<void> {
    const isDev = Bun.env.NODE_ENV === "development"
    const application = makeApplicationClient()
    let destroyRenderer = () => {}
    let shutdownPromise: Promise<void> | undefined
    const shutdown = (exitCode = 0) => {
        if (shutdownPromise) return shutdownPromise
        shutdownPromise = application.dispose().finally(() => {
            process.off("SIGINT", handleSigint)
            process.off("SIGTERM", handleSigterm)
            destroyRenderer()
            process.exit(exitCode)
        })
        return shutdownPromise
    }
    const handleSigint = () => void shutdown(130)
    const handleSigterm = () => void shutdown(143)
    process.once("SIGINT", handleSigint)
    process.once("SIGTERM", handleSigterm)

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

    _trace("before repositoryStatus()")
    const initialStatus = mockMode
        ? {
              isJjRepo:
                  mockMode !== "startup-no-vcs" && mockMode !== "startup-git",
              hasGitRepo: mockMode === "startup-git",
              startupError: null,
              repoPath: getRepoPath(),
          }
        : await application.repositoryStatus(getRepoPath())
    _trace("after repositoryStatus()")
    if (initialStatus.repoPath !== getRepoPath()) {
        setRepoPath(initialStatus.repoPath)
    }

    function Root() {
        _trace("Root() called")
        const renderer = useRenderer()
        destroyRenderer = () => renderer.destroy()
        const [isJjRepo, setIsJjRepo] = createSignal(initialStatus.isJjRepo)
        const [hasGitRepo, setHasGitRepo] = createSignal(
            initialStatus.hasGitRepo,
        )
        const [startupError, setStartupError] = createSignal<string | null>(
            initialStatus.startupError,
        )

        const handleSelectRepo = async (path: string) => {
            setRepoPath(path)
            const status = await application.repositoryStatus(path)
            if (status.repoPath !== path) {
                setRepoPath(status.repoPath)
            }
            setIsJjRepo(status.isJjRepo)
            setHasGitRepo(status.hasGitRepo)
            setStartupError(status.startupError)
        }

        const handleInitRepository = async (colocate: boolean) => {
            const result = await application.initializeRepository(
                getRepoPath(),
                { colocate },
            )
            if (result.success) setIsJjRepo(true)
        }

        const handleQuit = () => {
            void shutdown()
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
                        changes={
                            newChanges.length > 0
                                ? newChanges
                                : allBlocks.slice(0, 1)
                        }
                        onClose={handleQuit}
                        onDisable={handleQuit}
                        onDisableAutoUpdates={handleQuit}
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
            const status = await application.repositoryStatus(getRepoPath())
            if (status.repoPath !== getRepoPath()) {
                setRepoPath(status.repoPath)
            }
            setStartupError(status.startupError)
            setHasGitRepo(status.hasGitRepo)
            if (!status.startupError) setIsJjRepo(status.isJjRepo)
        }

        const handleFixStartup = async () => {
            const repoPath = getRepoPath()
            const result = await application.jjWorkspaceUpdateStale({
                cwd: repoPath,
            })
            if (result.success) {
                setStartupError(null)
                setIsJjRepo(true)
                return
            }

            setStartupError(
                [result.stdout, result.stderr].filter(Boolean).join("") ||
                    `jj workspace update-stale failed with exit code ${result.exitCode}`,
            )
        }

        return (
            <Show
                when={startupError()}
                fallback={
                    <Show
                        when={isJjRepo()}
                        fallback={
                            <ThemeProvider>
                                <StartupScreen
                                    hasGitRepo={hasGitRepo()}
                                    recentRepos={
                                        mockMode ? [] : getRecentRepos()
                                    }
                                    onSelectRepo={handleSelectRepo}
                                    onInitRepository={handleInitRepository}
                                    onQuit={handleQuit}
                                />
                            </ThemeProvider>
                        }
                    >
                        <App app={application} onQuit={shutdown} />
                    </Show>
                }
            >
                {(error: () => string) => (
                    <ThemeProvider>
                        <ErrorScreen
                            error={error()}
                            onRetry={handleRetryStartup}
                            onFix={handleFixStartup}
                            onQuit={handleQuit}
                        />
                    </ThemeProvider>
                )}
            </Show>
        )
    }

    _trace("before render()")
    render(() => <Root />, {
        consoleOptions: {
            position: ConsolePosition.BOTTOM,
            maxStoredLogs: 1000,
            sizePercent: 40,
        },
    })
}
