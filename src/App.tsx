import { useRenderer } from "@opentui/solid"
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { withCommandObserver } from "./commander/executor"
import { fetchOpLog, jjWorkspaceUpdateStale } from "./commander/operations"
import { getRevisionId } from "./commander/types"
import { ErrorScreen } from "./components/ErrorScreen"
import { LayoutGrid } from "./components/Layout"
import { WhatsNewScreen } from "./components/WhatsNewScreen"
import { ActionMenuModal } from "./components/modals/ActionMenuModal"
import {
    CommandPalette,
    commandPaletteContentWidth,
} from "./components/modals/CommandPalette"
import { DebugInfoModal } from "./components/modals/DebugInfoModal"
import { RecentReposModal } from "./components/modals/RecentReposModal"
import { UndoModal } from "./components/modals/UndoModal"

import type { ApplicationClient } from "./application/client"
import {
    createDefaultConfig,
    onConfigChange,
    readConfig,
    reloadConfig,
    writeConfig,
} from "./config"
import { CommandProvider, useCommand } from "./context/command"
import { CommandLogProvider, useCommandLog } from "./context/commandlog"
import {
    DIALOG_SIZE,
    DialogContainer,
    DialogProvider,
    useDialog,
} from "./context/dialog"
import { FocusProvider, type Panel, useFocus } from "./context/focus"
import { KeybindProvider } from "./context/keybind"
import { LayoutProvider, useLayout } from "./context/layout"
import { StatusProvider, useStatus } from "./context/status"
import { SyncProvider, useSync } from "./context/sync"
import { ThemeProvider, useTheme } from "./context/theme"
import { UpdateProvider, useUpdate } from "./context/update"
import { getRepoPath, setRepoPath } from "./repo"
import {
    getChangesSince,
    isMajorOrMinorUpdate,
    parseChangelog,
} from "./utils/changelog"
import type { VersionBlock } from "./utils/changelog"
import {
    getLogPath,
    writeDebugSnapshot,
    writeMemorySnapshot,
} from "./utils/diagnostics"
import { openInEditor, shouldSuspendForEditor } from "./utils/editor"
import { isCriticalStartupError, parseJjError } from "./utils/error-parser"
import { readState, writeState } from "./utils/state"
import { checkForUpdates, getCurrentVersion } from "./utils/update"

import changelogContent from "../CHANGELOG.md" with { type: "text" }

const GIT_ACTION_MENU_DIALOG = {
    width: "90%" as const,
    maxWidth: 48,
}

interface AppProps {
    app: ApplicationClient
    onQuit: () => void | Promise<void>
}

function AppContent({ app, onQuit }: AppProps) {
    const renderer = useRenderer()
    const {
        loadLog,
        loadBookmarks,
        loadRemoteBookmarks,
        refresh,
        error,
        loading,
        commits,
        enterFilesView,
        exitFilesView,
        selectedCommit,
        viewMode,
    } = useSync()
    const focus = useFocus()
    const command = useCommand()
    const dialog = useDialog()
    const commandLog = useCommandLog()
    const layout = useLayout()
    const update = useUpdate()
    const status = useStatus()
    const { setTheme, setThemeMode, setSyntaxTheme } = useTheme()
    const [whatsNewChanges, setWhatsNewChanges] = createSignal<
        VersionBlock[] | null
    >(null)

    const visiblePanels = (): Panel[] =>
        viewMode() === "files"
            ? ["log", "detail"]
            : ["log", "refs", "detail", "commandlog"]

    const focusPanel = (panel: Panel) => {
        if (!visiblePanels().includes(panel)) return
        focus.setPanel(panel)
    }

    const toggleDiffMode = async () => {
        if (layout.layoutMode() === "diff") {
            exitFilesView()
            layout.setLayoutMode("normal")
            return
        }
        await enterFilesView()
    }

    const cyclePanel = (direction: 1 | -1) => {
        if (viewMode() === "files") {
            const targets = ["log.files", "log.revisions", "detail"] as const
            const context = focus.activeContext()
            const current = context.startsWith("detail") ? "detail" : context
            const idx = Math.max(
                0,
                targets.indexOf(current as (typeof targets)[number]),
            )
            const next =
                targets[(idx + direction + targets.length) % targets.length]
            if (next) focus.setActiveContext(next)
            return
        }
        const panels = visiblePanels()
        const current = focus.panel()
        const idx = panels.indexOf(current)
        const next = panels[(idx + direction + panels.length) % panels.length]
        if (next) focus.setPanel(next)
    }

    createEffect(() => {
        const current = focus.panel()
        if (!visiblePanels().includes(current)) {
            const next = visiblePanels()[0]
            if (next) focus.setPanel(next)
        }
    })

    const hasCriticalError = () => {
        const err = error()
        const isLoading = loading()
        const hasNoData = commits().length === 0
        return !isLoading && hasNoData && isCriticalStartupError(err)
    }

    const handleRetry = async () => {
        await Promise.all([loadLog(), loadBookmarks(), loadRemoteBookmarks()])
    }

    const handleFix = async () => {
        const err = error()
        if (!err) return

        const parsed = parseJjError(err)
        if (parsed.errorType === "stale-working-copy") {
            const result = await withCommandObserver(
                commandLog.observer(),
                jjWorkspaceUpdateStale,
            )
            commandLog.addEntry(result)
            if (result.success) {
                await handleRetry()
            }
        }
    }

    onMount(() => {
        const unsubscribeConfig = onConfigChange((config) => {
            setTheme(config.ui.theme)
            setThemeMode(config.ui.themeMode)
            setSyntaxTheme(config.ui.syntaxTheme)
        })
        onCleanup(unsubscribeConfig)

        loadLog()
        loadBookmarks()
        loadRemoteBookmarks()
        let updateLogId: string | null = null
        checkForUpdates({
            onChecking: () => update.setChecking(),
            onUpdateAvailable: ({ currentVersion, latestVersion }) => {
                commandLog.info(
                    `kajji update available: v${currentVersion} → v${latestVersion}`,
                )
            },
            onUpdateStarted: ({ version, command }) => {
                update.setUpdating(version, command)
                updateLogId = commandLog.start(command)
            },
            onUpdateFinished: ({
                version,
                command,
                success,
                exitCode,
                stdout,
                stderr,
            }) => {
                if (success) update.setSuccess(version)
                else update.setFailure(version)
                if (updateLogId) {
                    const fallbackError = `Failed to update kajji to v${version}.\n\nTo install manually, run:\n   ${command}\n`
                    commandLog.finish(updateLogId, {
                        command,
                        stdout: success
                            ? stdout ||
                              `Updated kajji to v${version}.\n\nRestart to use the new version.\n`
                            : stdout,
                        stderr: success ? stderr : stderr || fallbackError,
                        exitCode,
                        success,
                    })
                }
            },
            onUpdateSkipped: () => update.setIdle(),
            onError: () => update.setFailure(""),
        })

        const state = readState()
        const config = readConfig()
        const currentVersion = getCurrentVersion()
        const allBlocks = parseChangelog(changelogContent)

        if (!state.lastSeenVersion) {
            writeState({ ...state, lastSeenVersion: currentVersion })
        } else if (
            !config.whatsNewDisabled &&
            currentVersion !== "0.0.0" &&
            state.lastSeenVersion !== currentVersion &&
            isMajorOrMinorUpdate(currentVersion, state.lastSeenVersion)
        ) {
            const newChanges = getChangesSince(allBlocks, state.lastSeenVersion)

            if (newChanges.length > 0) {
                setWhatsNewChanges(newChanges)
            } else {
                writeState({ ...state, lastSeenVersion: currentVersion })
            }
        }

        renderer.console.keyBindings = [
            { name: "y", ctrl: true, action: "copy-selection" },
        ]
        renderer.console.onCopySelection = (text) => {
            const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
            proc.stdin.write(text)
            proc.stdin.end()
        }
    })

    const runGitFetch = async (
        text: string,
        options?: Omit<
            Parameters<ApplicationClient["jjGitFetch"]>[0],
            "cwd" | "observer"
        >,
    ) => {
        const result = await app.jjGitFetch({
            ...options,
            cwd: getRepoPath(),
            observer: commandLog.observer(),
        })
        commandLog.addEntry(result)
        if (result.success) {
            refresh()
        }
    }

    const runGitPush = async (
        text: string,
        options?: Omit<
            Parameters<ApplicationClient["jjGitPush"]>[0],
            "cwd" | "observer"
        >,
    ) => {
        const result = await app.jjGitPush({
            ...options,
            cwd: getRepoPath(),
            observer: commandLog.observer(),
        })
        commandLog.addEntry(result)
        if (result.success) {
            refresh()
        }
    }

    const formatNamedList = (items: string[], flag: string) => {
        if (items.length === 0) return flag
        if (items.length === 1) return `${flag} ${items[0]}`
        if (items.length === 2) return `${flag} ${items[0]}, ${items[1]}`
        return `${flag} ${items[0]}, ${items[1]} +${items.length - 2}`
    }

    const openFetchMenu = () => {
        const commit =
            focus.activeContext() === "log.revisions" ? selectedCommit() : null
        const options = [
            {
                key: "a",
                mutedPrefix: "jj git fetch ",
                label: "--all-remotes",
                onSelect: () =>
                    void runGitFetch("Fetching all...", { allRemotes: true }),
            },
            {
                key: "t",
                mutedPrefix: "jj git fetch ",
                label: "--tracked",
                onSelect: () =>
                    void runGitFetch("Fetching tracked...", { tracked: true }),
            },
            {
                key: "p",
                mutedPrefix: "jj git fetch ",
                label: "--branch glob:push-*",
                onSelect: () =>
                    void runGitFetch("Fetching push branches...", {
                        branches: ["glob:push-*"],
                    }),
            },
        ]

        if (commit && commit.bookmarks.length > 0) {
            options.unshift({
                key: "b",
                mutedPrefix: "jj git fetch ",
                label: formatNamedList(commit.bookmarks, "--branch"),
                onSelect: () =>
                    void runGitFetch("Fetching selected branches...", {
                        branches: commit.bookmarks,
                    }),
            })
        }

        dialog.open(() => <ActionMenuModal options={options} />, {
            id: "fetch-menu",
            title: [{ text: "Fetch", style: "action" }, " options"],
            ...GIT_ACTION_MENU_DIALOG,
        })
    }

    const openPushMenu = () => {
        const commit =
            focus.activeContext() === "log.revisions" ? selectedCommit() : null
        const options = [
            {
                key: "a",
                mutedPrefix: "jj git push ",
                label: "--all",
                onSelect: () =>
                    void runGitPush("Pushing all...", { all: true }),
            },
            {
                key: "t",
                mutedPrefix: "jj git push ",
                label: "--tracked",
                onSelect: () =>
                    void runGitPush("Pushing tracked...", { tracked: true }),
            },
            {
                key: "d",
                mutedPrefix: "jj git push ",
                label: "--deleted",
                onSelect: () =>
                    void runGitPush("Pushing deleted...", { deleted: true }),
            },
            {
                key: "n",
                mutedPrefix: "jj git push ",
                label: "--dry-run",
                onSelect: () =>
                    void runGitPush("Dry run push...", { dryRun: true }),
            },
        ]

        if (commit) {
            if (commit.bookmarks.length > 0) {
                options.unshift({
                    key: "b",
                    mutedPrefix: "jj git push ",
                    label: formatNamedList(commit.bookmarks, "--bookmark"),
                    onSelect: () =>
                        void runGitPush("Pushing selected bookmarks...", {
                            bookmarks: commit.bookmarks,
                        }),
                })
            } else {
                options.unshift({
                    key: "c",
                    mutedPrefix: "jj git push ",
                    label: `--change ${getRevisionId(commit).slice(0, 8)}`,
                    onSelect: () =>
                        void runGitPush("Pushing selected change...", {
                            changes: [getRevisionId(commit)],
                        }),
                })
            }
        }

        dialog.open(() => <ActionMenuModal options={options} />, {
            id: "push-menu",
            title: [{ text: "Push", style: "action" }, " options"],
            ...GIT_ACTION_MENU_DIALOG,
        })
    }

    command.register(() => [
        ...(viewMode() === "files"
            ? [
                  {
                      id: "global.exit_files",
                      title: "back",
                      keybind: "escape" as const,
                      context: "global" as const,
                      visibleIn: ["palette"] as const,
                      execute: exitFilesView,
                  },
              ]
            : []),
        {
            id: "global.quit",
            title: "quit",
            keybind: "quit",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: onQuit,
        },
        ...(Bun.env.NODE_ENV === "development"
            ? [
                  {
                      id: "global.toggle_console",
                      title: "console",
                      keybind: "toggle_console" as const,
                      context: "global" as const,
                      visibleIn: ["palette", "statusBar"] as const,
                      execute: () => renderer.console.toggle(),
                  },
              ]
            : []),
        {
            id: "global.focus_next",
            title: "next panel",
            keybind: "focus_next",
            context: "global",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => cyclePanel(1),
        },
        {
            id: "global.focus_prev",
            title: "previous panel",
            keybind: "focus_prev",
            context: "global",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => cyclePanel(-1),
        },
        {
            id: "global.focus_panel_1",
            title: "focus log panel",
            keybind: "focus_panel_1",
            context: "global",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () =>
                viewMode() === "files"
                    ? focus.setActiveContext("log.files")
                    : focusPanel("log"),
        },
        {
            id: "global.focus_panel_2",
            title: "focus refs panel",
            keybind: "focus_panel_2",
            context: "global",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () =>
                viewMode() === "files"
                    ? focus.setActiveContext("log.revisions")
                    : focusPanel("refs"),
        },
        {
            id: "global.focus_panel_3",
            title: "focus detail panel",
            keybind: "focus_panel_3",
            context: "global",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => focusPanel("detail"),
        },
        {
            id: "global.focus_panel_4",
            title: "command log",
            keybind: "focus_panel_4",
            context: "global",
            group: "navigation",
            visibleIn: ["palette"] as const,
            execute: () => focusPanel("commandlog"),
        },
        {
            id: "global.command_palette",
            title: "commands",
            keybind: "command_palette",
            context: "global",

            visibleIn: ["palette", "statusBar"] as const,
            scope: "always",
            execute: () => {
                const dialogPadding = 6
                dialog.toggle("commandPalette", () => <CommandPalette />, {
                    title: "Commands",
                    width: commandPaletteContentWidth() + dialogPadding,
                    paddingHorizontal: dialogPadding / 2,
                })
            },
        },
        {
            id: "global.switch_repository",
            title: "switch repo",
            keybind: "open_recent",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: () =>
                dialog.open(
                    () => (
                        <RecentReposModal
                            onSelect={(path) => {
                                setRepoPath(path)
                                refresh()
                            }}
                        />
                    ),
                    {
                        title: "Recent repositories",
                        ...DIALOG_SIZE.form,
                        hints: [{ key: "1-9", label: "open" }],
                    },
                ),
        },
        {
            id: "global.open_config",
            title: "open config",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: async () => {
                const configPath = createDefaultConfig()
                const shouldSuspend = shouldSuspendForEditor()
                if (shouldSuspend) renderer.suspend?.()
                try {
                    await openInEditor([configPath])
                } finally {
                    if (shouldSuspend) renderer.resume?.()
                }
                reloadConfig()
            },
        },
        {
            id: "global.open_logs",
            title: "open logs",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: async () => {
                const shouldSuspend = shouldSuspendForEditor()
                if (shouldSuspend) renderer.suspend?.()
                try {
                    await openInEditor([getLogPath()])
                } finally {
                    if (shouldSuspend) renderer.resume?.()
                }
            },
        },
        {
            id: "global.view_debug_info",
            title: "view debug info",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: () =>
                dialog.open(() => <DebugInfoModal />, {
                    id: "debug-info",
                    title: "Debug info",
                    ...DIALOG_SIZE.confirmWide,
                }),
        },
        {
            id: "global.write_debug_snapshot",
            title: "write debug snapshot",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: () => {
                try {
                    const path = writeDebugSnapshot()
                    status.show(`Debug snapshot: ${path}`, {
                        kind: "success",
                        duration: 5000,
                    })
                } catch (error) {
                    console.error("Failed to write debug snapshot:", error)
                    status.show("Failed to write debug snapshot", {
                        kind: "error",
                    })
                }
            },
        },
        {
            id: "global.write_heap_snapshot",
            title: "capture heap snapshot",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: () => {
                status.show("Capturing heap snapshot...", { duration: 0 })
                setTimeout(() => {
                    try {
                        const path = writeMemorySnapshot()
                        status.show(`Heap snapshot: ${path}`, {
                            kind: "success",
                            duration: 5000,
                        })
                    } catch (error) {
                        console.error("Failed to capture heap snapshot:", error)
                        status.show("Failed to capture heap snapshot", {
                            kind: "error",
                        })
                    }
                }, 0)
            },
        },
        {
            id: "global.refresh",
            title: "refresh",
            keybind: "refresh",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: () => refresh(),
        },
        {
            id: "global.toggle_focus_mode",
            title: "diff mode",
            keybind: "toggle_focus_mode",
            context: "global",

            visibleIn: ["palette", "statusBar"] as const,
            execute: toggleDiffMode,
        },
        {
            id: "global.git_fetch",
            title: "git fetch",
            keybind: "jj_git_fetch",
            context: "global",
            group: "repository",
            visibleIn: ["palette"] as const,
            execute: () => {
                void runGitFetch("Fetching...")
            },
        },
        {
            id: "global.git_fetch_all",
            title: "fetch menu",
            keybind: "jj_git_fetch_all",
            context: "global",
            group: "repository",
            visibleIn: ["palette"] as const,
            execute: openFetchMenu,
        },
        {
            id: "global.git_push",
            title: "git push",
            keybind: "jj_git_push",
            context: "global",
            group: "repository",
            visibleIn: ["palette"] as const,
            execute: () => {
                void runGitPush("Pushing...")
            },
        },
        {
            id: "global.git_push_all",
            title: "push menu",
            keybind: "jj_git_push_all",
            context: "global",
            group: "repository",
            visibleIn: ["palette"] as const,
            execute: openPushMenu,
        },
        {
            id: "global.undo",
            title: "undo",
            keybind: "jj_undo",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: async () => {
                const opLines = await fetchOpLog(1)
                dialog.open(
                    () => (
                        <UndoModal
                            type="undo"
                            operationLines={opLines}
                            onConfirm={async () => {
                                dialog.close()
                                const result = await app.jjUndo({
                                    cwd: getRepoPath(),
                                    observer: commandLog.observer(),
                                })
                                commandLog.addEntry(result)
                                if (result.success) {
                                    refresh()
                                }
                            }}
                            onCancel={() => dialog.close()}
                        />
                    ),
                    {
                        id: "undo-modal",
                        title: "Undo last operation?",
                        ...DIALOG_SIZE.form,
                        closeOnEsc: false,
                    },
                )
            },
        },
        {
            id: "global.redo",
            title: "redo",
            keybind: "jj_redo",
            context: "global",

            visibleIn: ["palette"] as const,
            execute: async () => {
                const opLines = await fetchOpLog(1)
                dialog.open(
                    () => (
                        <UndoModal
                            type="redo"
                            operationLines={opLines}
                            onConfirm={async () => {
                                dialog.close()
                                const result = await app.jjRedo({
                                    cwd: getRepoPath(),
                                    observer: commandLog.observer(),
                                })
                                commandLog.addEntry(result)
                                if (result.success) {
                                    refresh()
                                }
                            }}
                            onCancel={() => dialog.close()}
                        />
                    ),
                    {
                        id: "redo-modal",
                        title: "Redo last operation?",
                        ...DIALOG_SIZE.form,
                        closeOnEsc: false,
                    },
                )
            },
        },
    ])

    // Show error screen for critical startup errors
    if (hasCriticalError()) {
        const err = error()
        if (err) {
            const parsed = parseJjError(err)
            return (
                <ErrorScreen
                    error={err}
                    onRetry={handleRetry}
                    onFix={parsed.fixCommand ? handleFix : undefined}
                    onQuit={onQuit}
                />
            )
        }
    }

    return (
        <Show
            when={whatsNewChanges()}
            fallback={
                <DialogContainer>
                    <LayoutGrid />
                </DialogContainer>
            }
        >
            <WhatsNewScreen
                changes={whatsNewChanges() ?? []}
                onClose={() => {
                    setWhatsNewChanges(null)
                    writeState({
                        ...readState(),
                        lastSeenVersion: getCurrentVersion(),
                    })
                }}
                onDisable={() => {
                    setWhatsNewChanges(null)
                    writeConfig({
                        ...readConfig(),
                        whatsNewDisabled: true,
                    })
                    writeState({
                        ...readState(),
                        lastSeenVersion: getCurrentVersion(),
                    })
                }}
                onDisableAutoUpdates={() => {
                    setWhatsNewChanges(null)
                    writeConfig({
                        ...readConfig(),
                        autoUpdatesDisabled: true,
                    })
                    writeState({
                        ...readState(),
                        lastSeenVersion: getCurrentVersion(),
                    })
                }}
            />
        </Show>
    )
}

export function App({ app, onQuit }: AppProps) {
    return (
        <ThemeProvider>
            <FocusProvider>
                <LayoutProvider>
                    <SyncProvider>
                        <KeybindProvider>
                            <CommandLogProvider>
                                <StatusProvider>
                                    <DialogProvider>
                                        <UpdateProvider>
                                            <CommandProvider>
                                                <AppContent
                                                    app={app}
                                                    onQuit={onQuit}
                                                />
                                            </CommandProvider>
                                        </UpdateProvider>
                                    </DialogProvider>
                                </StatusProvider>
                            </CommandLogProvider>
                        </KeybindProvider>
                    </SyncProvider>
                </LayoutProvider>
            </FocusProvider>
        </ThemeProvider>
    )
}
