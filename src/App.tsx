import { useRenderer } from "@opentui/solid"
import { Show, onMount } from "solid-js"
import { Layout } from "./components/Layout"
import { HelpModal } from "./components/modals/HelpModal"
import { BookmarksPanel } from "./components/panels/BookmarksPanel"
import { FileTreePanel } from "./components/panels/FileTreePanel"
import { LogPanel } from "./components/panels/LogPanel"
import { MainArea } from "./components/panels/MainArea"
import { CommandProvider, useCommand } from "./context/command"
import { CommandLogProvider } from "./context/commandlog"
import { DialogContainer, DialogProvider, useDialog } from "./context/dialog"
import { FocusProvider, useFocus } from "./context/focus"
import { KeybindProvider } from "./context/keybind"
import { SyncProvider, useSync } from "./context/sync"
import { ThemeProvider } from "./context/theme"

function TopPanel() {
	const { viewMode } = useSync()

	return (
		<Show when={viewMode() === "files"} fallback={<LogPanel />}>
			<FileTreePanel />
		</Show>
	)
}

function AppContent() {
	const renderer = useRenderer()
	const { loadLog, loadBookmarks } = useSync()
	const focus = useFocus()
	const command = useCommand()
	const dialog = useDialog()

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
			title: "Quit",
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
						title: "Toggle Console",
						keybind: "toggle_console" as const,
						context: "global" as const,
						type: "action" as const,
						onSelect: () => renderer.console.toggle(),
					},
				]
			: []),
		{
			id: "global.focus_next",
			title: "Focus Next Panel",
			keybind: "focus_next",
			context: "global",
			type: "navigation",
			hidden: true,
			onSelect: () => focus.cycleNext(),
		},
		{
			id: "global.focus_prev",
			title: "Focus Previous Panel",
			keybind: "focus_prev",
			context: "global",
			type: "navigation",
			hidden: true,
			onSelect: () => focus.cyclePrev(),
		},
		{
			id: "global.focus_panel_1",
			title: "Focus Log Panel",
			keybind: "focus_panel_1",
			context: "global",
			type: "navigation",
			hidden: true,
			onSelect: () => focus.setPanel("log"),
		},
		{
			id: "global.focus_panel_2",
			title: "Focus Bookmarks Panel",
			keybind: "focus_panel_2",
			context: "global",
			type: "navigation",
			hidden: true,
			onSelect: () => focus.setPanel("bookmarks"),
		},
		{
			id: "global.focus_panel_3",
			title: "Focus Diff Panel",
			keybind: "focus_panel_3",
			context: "global",
			type: "navigation",
			hidden: true,
			onSelect: () => focus.setPanel("diff"),
		},
		{
			id: "global.help",
			title: "Help",
			keybind: "help",
			context: "global",
			type: "action",
			onSelect: () => dialog.toggle("help", () => <HelpModal />),
		},
		{
			id: "global.refresh",
			title: "Refresh",
			keybind: "refresh",
			context: "global",
			type: "action",
			onSelect: () => {
				loadLog()
				loadBookmarks()
			},
		},
	])

	return (
		<DialogContainer>
			<Layout
				top={<TopPanel />}
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
			</FocusProvider>
		</ThemeProvider>
	)
}
