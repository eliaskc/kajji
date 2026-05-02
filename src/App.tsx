import { useRenderer } from "@opentui/solid"
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { withCommandObserver } from "./commander/executor"
import {
	fetchOpLog,
	jjGitFetch,
	jjGitPush,
	jjRedo,
	jjUndo,
	jjWorkspaceUpdateStale,
} from "./commander/operations"
import { getRevisionId } from "./commander/types"
import { ErrorScreen } from "./components/ErrorScreen"
import { LayoutGrid } from "./components/Layout"
import { WhatsNewScreen } from "./components/WhatsNewScreen"
import { ActionMenuModal } from "./components/modals/ActionMenuModal"
import { HelpModal, helpContentWidth } from "./components/modals/HelpModal"
import { RecentReposModal } from "./components/modals/RecentReposModal"
import { UndoModal } from "./components/modals/UndoModal"

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
import { SyncProvider, useSync } from "./context/sync"
import { ThemeProvider, useTheme } from "./context/theme"
import { UpdateProvider, useUpdate } from "./context/update"
import { setRepoPath } from "./repo"
import {
	getChangesSince,
	isMajorOrMinorUpdate,
	parseChangelog,
} from "./utils/changelog"
import type { VersionBlock } from "./utils/changelog"
import { openInEditor, shouldSuspendForEditor } from "./utils/editor"
import { isCriticalStartupError, parseJjError } from "./utils/error-parser"
import { readState, writeState } from "./utils/state"
import { checkForUpdates, getCurrentVersion } from "./utils/update"

import changelogContent from "../CHANGELOG.md" with { type: "text" }

const GIT_ACTION_MENU_DIALOG = {
	width: "90%" as const,
	maxWidth: 48,
}

function AppContent() {
	const renderer = useRenderer()
	const {
		loadLog,
		loadBookmarks,
		loadRemoteBookmarks,
		refresh,
		error,
		loading,
		commits,
		selectedCommit,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()
	const dialog = useDialog()
	const commandLog = useCommandLog()
	const layout = useLayout()
	const update = useUpdate()
	const { setTheme, setThemeMode, setSyntaxTheme } = useTheme()
	const [whatsNewChanges, setWhatsNewChanges] = createSignal<
		VersionBlock[] | null
	>(null)

	const visiblePanels: Panel[] = ["log", "refs", "detail", "commandlog"]

	const focusPanel = (panel: Panel) => {
		if (!visiblePanels.includes(panel)) return
		focus.setPanel(panel)
	}

	const cyclePanel = (direction: 1 | -1) => {
		const current = focus.panel()
		const idx = visiblePanels.indexOf(current)
		const next =
			visiblePanels[
				(idx + direction + visiblePanels.length) % visiblePanels.length
			]
		if (next) focus.setPanel(next)
	}

	createEffect(() => {
		const current = focus.panel()
		if (!visiblePanels.includes(current)) {
			const next = visiblePanels[0]
			if (next) focus.setPanel(next)
		}
	})

	const hasCriticalError = () => {
		const err = error()
		const isLoading = loading()
		const hasNoData = commits().length === 0
		return !isLoading && hasNoData && isCriticalStartupError(err)
	}

	const handleRetry = () => {
		loadLog()
		loadBookmarks()
	}

	const handleFix = async () => {
		const err = error()
		if (!err) return

		const parsed = parseJjError(err)
		if (parsed.errorType === "stale-working-copy") {
			const result = await jjWorkspaceUpdateStale()
			if (result.success) {
				handleRetry()
			}
		}
	}

	const handleQuit = () => {
		renderer.destroy()
		process.exit(0)
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
			onUpdateFinished: ({ version, command, success }) => {
				if (success) update.setSuccess(version)
				else update.setFailure(version)
				if (updateLogId) {
					commandLog.finish(updateLogId, {
						command,
						stdout: success
							? `Updated kajji to v${version}.\n\nRestart to use the new version.\n`
							: "",
						stderr: success
							? ""
							: `Failed to update kajji to v${version}.\n\nTo install manually, run:\n   ${command}\n`,
						exitCode: success ? 0 : 1,
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
		options?: Parameters<typeof jjGitFetch>[0],
	) => {
		const observer = commandLog.observer()
		const result = await withCommandObserver(observer, () =>
			jjGitFetch({ ...options, observer }),
		)
		commandLog.addEntry(result)
		if (result.success) {
			refresh()
		}
	}

	const runGitPush = async (
		text: string,
		options?: Parameters<typeof jjGitPush>[0],
	) => {
		const observer = commandLog.observer()
		const result = await withCommandObserver(observer, () =>
			jjGitPush({ ...options, observer }),
		)
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
					void runGitFetch("Fetching stack branches...", {
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
			hints: [{ key: "enter", label: "run" }],
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
				onSelect: () => void runGitPush("Pushing all...", { all: true }),
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
				onSelect: () => void runGitPush("Dry run push...", { dryRun: true }),
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
			hints: [{ key: "enter", label: "run" }],
		})
	}

	command.register(() => [
		{
			id: "global.quit",
			title: "quit",
			keybind: "quit",
			context: "global",
			type: "action",
			visibility: "help-only",
			onSelect: () => {
				renderer.destroy()
				process.exit(0)
			},
		},
		...(Bun.env.NODE_ENV === "development"
			? [
					{
						id: "global.toggle_console",
						title: "console",
						keybind: "toggle_console" as const,
						context: "global" as const,
						type: "action" as const,
						onSelect: () => renderer.console.toggle(),
					},
				]
			: []),
		{
			id: "global.focus_next",
			title: "next panel",
			keybind: "focus_next",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => cyclePanel(1),
		},
		{
			id: "global.focus_prev",
			title: "previous panel",
			keybind: "focus_prev",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => cyclePanel(-1),
		},
		{
			id: "global.focus_panel_1",
			title: "focus log panel",
			keybind: "focus_panel_1",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focusPanel("log"),
		},
		{
			id: "global.focus_panel_2",
			title: "focus refs panel",
			keybind: "focus_panel_2",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focusPanel("refs"),
		},
		{
			id: "global.focus_panel_3",
			title: "focus detail panel",
			keybind: "focus_panel_3",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focusPanel("detail"),
		},
		{
			id: "global.focus_panel_4",
			title: "command log",
			keybind: "focus_panel_4",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focusPanel("commandlog"),
		},
		{
			id: "global.help",
			title: "commands",
			keybind: "help",
			context: "global",
			type: "action",
			onSelect: () => {
				const dialogPadding = 4
				dialog.toggle("help", () => <HelpModal />, {
					title: "Commands",
					width: () =>
						helpContentWidth(layout.helpModalColumns()) + dialogPadding,
					hints: [{ key: "enter", label: "execute" }],
				})
			},
		},
		{
			id: "global.switch_repository",
			title: "switch repo",
			keybind: "open_recent",
			context: "global",
			type: "action",
			visibility: "help-only",
			onSelect: () =>
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
						hints: [
							{ key: "j/k", label: "select" },
							{ key: "1-9", label: "open" },
							{ key: "enter", label: "switch" },
						],
					},
				),
		},
		{
			id: "global.open_config",
			title: "open config",
			context: "global",
			type: "action",
			visibility: "help-only",
			onSelect: async () => {
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
			id: "global.refresh",
			title: "refresh",
			keybind: "refresh",
			context: "global",
			type: "action",
			visibility: "help-only",
			onSelect: () => refresh(),
		},
		{
			id: "global.toggle_focus_mode",
			title: "focus",
			keybind: "toggle_focus_mode",
			context: "global",
			type: "action",
			onSelect: () => layout.toggleFocusMode(),
		},
		{
			id: "global.git_fetch",
			title: "git fetch",
			keybind: "jj_git_fetch",
			context: "global",
			type: "git",
			visibility: "help-only",
			onSelect: () => {
				void runGitFetch("Fetching...")
			},
		},
		{
			id: "global.git_fetch_all",
			title: "fetch menu",
			keybind: "jj_git_fetch_all",
			context: "global",
			type: "git",
			visibility: "help-only",
			onSelect: openFetchMenu,
		},
		{
			id: "global.git_push",
			title: "git push",
			keybind: "jj_git_push",
			context: "global",
			type: "git",
			visibility: "help-only",
			onSelect: () => {
				void runGitPush("Pushing...")
			},
		},
		{
			id: "global.git_push_all",
			title: "push menu",
			keybind: "jj_git_push_all",
			context: "global",
			type: "git",
			visibility: "help-only",
			onSelect: openPushMenu,
		},
		{
			id: "global.undo",
			title: "undo",
			keybind: "jj_undo",
			context: "global",
			type: "action",
			visibility: "help-only",
			onSelect: async () => {
				const opLines = await fetchOpLog(1)
				dialog.open(
					() => (
						<UndoModal
							type="undo"
							operationLines={opLines}
							onConfirm={async () => {
								dialog.close()
								const observer = commandLog.observer()
								const result = await withCommandObserver(observer, jjUndo)
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
						hints: [
							{ key: "y", label: "confirm" },
							{ key: "n", label: "cancel" },
						],
					},
				)
			},
		},
		{
			id: "global.redo",
			title: "redo",
			keybind: "jj_redo",
			context: "global",
			type: "action",
			visibility: "help-only",
			onSelect: async () => {
				const opLines = await fetchOpLog(1)
				dialog.open(
					() => (
						<UndoModal
							type="redo"
							operationLines={opLines}
							onConfirm={async () => {
								dialog.close()
								const observer = commandLog.observer()
								const result = await withCommandObserver(observer, jjRedo)
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
						hints: [
							{ key: "y", label: "confirm" },
							{ key: "n", label: "cancel" },
						],
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
					onQuit={handleQuit}
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
			/>
		</Show>
	)
}

export function App() {
	return (
		<ThemeProvider>
			<FocusProvider>
				<LayoutProvider>
					<SyncProvider>
						<KeybindProvider>
							<CommandLogProvider>
								<DialogProvider>
									<UpdateProvider>
										<CommandProvider>
											<AppContent />
										</CommandProvider>
									</UpdateProvider>
								</DialogProvider>
							</CommandLogProvider>
						</KeybindProvider>
					</SyncProvider>
				</LayoutProvider>
			</FocusProvider>
		</ThemeProvider>
	)
}
