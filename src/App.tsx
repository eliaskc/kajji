import { useRenderer } from "@opentui/solid"
import { onMount } from "solid-js"
import { jjGitFetch, jjGitPush, jjRedo, jjUndo } from "./commander/operations"
import { Layout } from "./components/Layout"
import { HelpModal } from "./components/modals/HelpModal"
import { UndoModal } from "./components/modals/UndoModal"
import { BookmarksPanel } from "./components/panels/BookmarksPanel"
import { LogPanel } from "./components/panels/LogPanel"
import { MainArea } from "./components/panels/MainArea"
import { CommandProvider, useCommand } from "./context/command"
import { CommandLogProvider, useCommandLog } from "./context/commandlog"
import { DialogContainer, DialogProvider, useDialog } from "./context/dialog"
import { FocusProvider, useFocus } from "./context/focus"
import { KeybindProvider } from "./context/keybind"
import { LayoutProvider } from "./context/layout"
import { LoadingProvider, useLoading } from "./context/loading"
import { SyncProvider, useSync } from "./context/sync"
import { ThemeProvider } from "./context/theme"

function AppContent() {
	const renderer = useRenderer()
	const { loadLog, loadBookmarks, refresh } = useSync()
	const focus = useFocus()
	const command = useCommand()
	const dialog = useDialog()
	const commandLog = useCommandLog()
	const globalLoading = useLoading()

	onMount(() => {
		loadLog()
		loadBookmarks()

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
			title: "help",
			keybind: "help",
			context: "global",
			type: "action",
			onSelect: () =>
				dialog.toggle("help", () => <HelpModal />, {
					hints: [{ key: "enter", label: "execute" }],
				}),
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
			onSelect: () => {
				dialog.open(
					() => (
						<UndoModal
							type="undo"
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
			onSelect: () => {
				dialog.open(
					() => (
						<UndoModal
							type="redo"
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

	return (
		<DialogContainer>
			<Layout
				top={<LogPanel />}
				bottom={<BookmarksPanel />}
				right={<MainArea />}
			/>
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
