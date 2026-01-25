import { Toaster } from "@opentui-ui/toast/solid"
import { useRenderer } from "@opentui/solid"
import { Show, onMount } from "solid-js"
import {
	fetchOpLog,
	jjGitFetch,
	jjGitPush,
	jjRedo,
	jjUndo,
	jjWorkspaceUpdateStale,
} from "./commander/operations"
import { ErrorScreen } from "./components/ErrorScreen"
import { LayoutGrid } from "./components/Layout"
import { HelpModal } from "./components/modals/HelpModal"
import { RecentReposModal } from "./components/modals/RecentReposModal"
import { UndoModal } from "./components/modals/UndoModal"
import { WhatsNewModal } from "./components/modals/WhatsNewModal"

import { CommandProvider, useCommand } from "./context/command"
import { CommandLogProvider, useCommandLog } from "./context/commandlog"
import { DialogContainer, DialogProvider, useDialog } from "./context/dialog"
import { FocusProvider, useFocus } from "./context/focus"
import { KeybindProvider } from "./context/keybind"
import { LayoutProvider, useLayout } from "./context/layout"
import { LoadingProvider, useLoading } from "./context/loading"
import { SyncProvider, useSync } from "./context/sync"
import { ThemeProvider, useTheme } from "./context/theme"
import { setRepoPath } from "./repo"
import { getChangesSince, parseChangelog } from "./utils/changelog"
import { isCriticalStartupError, parseJjError } from "./utils/error-parser"
import { readState, writeState } from "./utils/state"
import { checkForUpdates, getCurrentVersion } from "./utils/update"

import changelogContent from "../CHANGELOG.md" with { type: "text" }

function AppContent() {
	const renderer = useRenderer()
	const { loadLog, loadBookmarks, refresh, error, loading, commits } = useSync()
	const focus = useFocus()
	const command = useCommand()
	const dialog = useDialog()
	const commandLog = useCommandLog()
	const globalLoading = useLoading()
	const layout = useLayout()
	const { colors, style } = useTheme()

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
		loadLog()
		loadBookmarks()
		checkForUpdates()

		const state = readState()
		const currentVersion = getCurrentVersion()
		const allBlocks = parseChangelog(changelogContent)

		if (!state.lastSeenVersion) {
			writeState({ ...state, lastSeenVersion: currentVersion })
		} else if (
			!state.whatsNewDisabled &&
			currentVersion !== "0.0.0" &&
			state.lastSeenVersion !== currentVersion
		) {
			const newChanges = getChangesSince(allBlocks, state.lastSeenVersion)

			if (newChanges.length > 0) {
				dialog.open(() => (
					<WhatsNewModal
						changes={newChanges}
						onClose={() => {
							dialog.close()
							writeState({
								...readState(),
								lastSeenVersion: currentVersion,
							})
						}}
						onDisable={() => {
							dialog.close()
							writeState({
								...readState(),
								lastSeenVersion: currentVersion,
								whatsNewDisabled: true,
							})
						}}
					/>
				))
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
						title: "toggle console",
						keybind: "toggle_console" as const,
						context: "global" as const,
						type: "action" as const,
						onSelect: () => renderer.console.toggle(),
					},
				]
			: []),
		{
			id: "global.focus_next",
			title: "focus next panel",
			keybind: "focus_next",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focus.cycleNext(),
		},
		{
			id: "global.focus_prev",
			title: "focus previous panel",
			keybind: "focus_prev",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focus.cyclePrev(),
		},
		{
			id: "global.focus_panel_1",
			title: "focus log panel",
			keybind: "focus_panel_1",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focus.setPanel("log"),
		},
		{
			id: "global.focus_panel_2",
			title: "focus refs panel",
			keybind: "focus_panel_2",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focus.setPanel("refs"),
		},
		{
			id: "global.focus_panel_3",
			title: "focus detail panel",
			keybind: "focus_panel_3",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focus.setPanel("detail"),
		},
		{
			id: "global.focus_panel_4",
			title: "focus command log",
			keybind: "focus_panel_4",
			context: "global",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => focus.setPanel("commandlog"),
		},
		{
			id: "global.help",
			title: "commands",
			keybind: "help",
			context: "global",
			type: "action",
			onSelect: () =>
				dialog.toggle("help", () => <HelpModal />, {
					hints: [{ key: "enter", label: "execute" }],
				}),
		},
		{
			id: "global.switch_repository",
			title: "switch repository",
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
						hints: [
							{ key: "j/k", label: "select" },
							{ key: "1-9", label: "open" },
							{ key: "enter", label: "switch" },
						],
					},
				),
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
			title: "view",
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
			onSelect: async () => {
				const result = await globalLoading.run("Fetching...", () =>
					jjGitFetch(),
				)
				commandLog.addEntry(result)
				if (result.success) {
					refresh()
				}
			},
		},
		{
			id: "global.git_fetch_all",
			title: "git fetch all",
			keybind: "jj_git_fetch_all",
			context: "global",
			type: "git",
			visibility: "help-only",
			onSelect: async () => {
				const result = await globalLoading.run("Fetching all...", () =>
					jjGitFetch({ allRemotes: true }),
				)
				commandLog.addEntry(result)
				if (result.success) {
					refresh()
				}
			},
		},
		{
			id: "global.git_push",
			title: "git push",
			keybind: "jj_git_push",
			context: "global",
			type: "git",
			visibility: "help-only",
			onSelect: async () => {
				const result = await globalLoading.run("Pushing...", () => jjGitPush())
				commandLog.addEntry(result)
				if (result.success) {
					refresh()
				}
			},
		},
		{
			id: "global.git_push_all",
			title: "git push all",
			keybind: "jj_git_push_all",
			context: "global",
			type: "git",
			visibility: "help-only",
			onSelect: async () => {
				const result = await globalLoading.run("Pushing all...", () =>
					jjGitPush({ all: true }),
				)
				commandLog.addEntry(result)
				if (result.success) {
					refresh()
				}
			},
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
								const result = await globalLoading.run("Undoing...", jjUndo)
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
								const result = await globalLoading.run("Redoing...", jjRedo)
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

	const toasterOptions = () => ({
		position: "top-right" as const,
		toastOptions: {
			style: {
				backgroundColor: colors().background,
				foregroundColor: colors().text,
				borderColor: colors().border,
				borderStyle: style().panel.borderStyle,
				mutedColor: colors().textMuted,
			},
			success: {
				style: { borderColor: colors().success },
			},
			error: {
				style: { borderColor: colors().error },
			},
			warning: {
				style: { borderColor: colors().warning },
			},
			info: {
				style: { borderColor: colors().info },
			},
		},
	})

	return (
		<DialogContainer>
			<LayoutGrid />
			<Toaster {...toasterOptions()} />
		</DialogContainer>
	)
}

export function App() {
	return (
		<ThemeProvider>
			<FocusProvider>
				<LayoutProvider>
					<LoadingProvider>
						<SyncProvider>
							<KeybindProvider>
								<CommandLogProvider>
									<DialogProvider>
										<CommandProvider>
											<AppContent />
										</CommandProvider>
									</DialogProvider>
								</CommandLogProvider>
							</KeybindProvider>
						</SyncProvider>
					</LoadingProvider>
				</LayoutProvider>
			</FocusProvider>
		</ThemeProvider>
	)
}
