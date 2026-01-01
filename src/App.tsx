import { useRenderer } from "@opentui/solid"
import { Show, onMount } from "solid-js"
import { Layout } from "./components/Layout"
import { HelpModal } from "./components/modals/HelpModal"
import { BookmarksPanel } from "./components/panels/BookmarksPanel"
import { FileTreePanel } from "./components/panels/FileTreePanel"
import { LogPanel } from "./components/panels/LogPanel"
import { MainArea } from "./components/panels/MainArea"
import { CommandProvider, useCommand } from "./context/command"
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
			category: "UI",
			onSelect: () => {
				renderer.destroy()
				process.exit(0)
			},
		},
		...(typeof DEV !== "undefined" && DEV === true
			? [
					{
						id: "global.toggle_console",
						title: "Toggle Console",
						keybind: "toggle_console" as const,
						context: "global" as const,
						category: "UI",
						onSelect: () => renderer.console.toggle(),
					},
				]
			: []),
		{
			id: "global.focus_next",
			title: "Focus Next Panel",
			keybind: "focus_next",
			context: "global",
			category: "UI",
			hidden: true,
			onSelect: () => focus.cycleNext(),
		},
		{
			id: "global.focus_prev",
			title: "Focus Previous Panel",
			keybind: "focus_prev",
			context: "global",
			category: "UI",
			hidden: true,
			onSelect: () => focus.cyclePrev(),
		},
		{
			id: "global.focus_panel_1",
			title: "Focus Log Panel",
			keybind: "focus_panel_1",
			context: "global",
			category: "UI",
			hidden: true,
			onSelect: () => focus.set("log"),
		},
		{
			id: "global.focus_panel_2",
			title: "Focus Bookmarks Panel",
			keybind: "focus_panel_2",
			context: "global",
			category: "UI",
			hidden: true,
			onSelect: () => focus.set("bookmarks"),
		},
		{
			id: "global.focus_panel_3",
			title: "Focus Diff Panel",
			keybind: "focus_panel_3",
			context: "global",
			category: "UI",
			hidden: true,
			onSelect: () => focus.set("diff"),
		},
		{
			id: "global.help",
			title: "Help",
			keybind: "help",
			context: "global",
			category: "UI",
			onSelect: () => dialog.toggle("help", () => <HelpModal />),
		},
		{
			id: "global.refresh",
			title: "Refresh",
			keybind: "refresh",
			context: "global",
			category: "UI",
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
						<DialogProvider>
							<CommandProvider>
								<AppContent />
							</CommandProvider>
						</DialogProvider>
					</KeybindProvider>
				</SyncProvider>
			</FocusProvider>
		</ThemeProvider>
	)
}
