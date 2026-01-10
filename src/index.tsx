import { ConsolePosition } from "@opentui/core"
import { extend, render } from "@opentui/solid"
import { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer"
import { App } from "./App"
import { initHighlighter } from "./diff"
import { setRepoPath } from "./repo"

// Parse CLI args - first positional arg is repo path
const args = process.argv.slice(2)
if (args[0] && !args[0].startsWith("-")) {
	setRepoPath(args[0])
}

extend({ "ghostty-terminal": GhosttyTerminalRenderable })

initHighlighter()

render(() => <App />, {
	consoleOptions: {
		position: ConsolePosition.BOTTOM,
		maxStoredLogs: 1000,
		sizePercent: 40,
	},
})
