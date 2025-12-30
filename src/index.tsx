import { ConsolePosition } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./App"

render(() => <App />, {
	consoleOptions: {
		position: ConsolePosition.BOTTOM,
		maxStoredLogs: 1000,
		sizePercent: 40,
	},
})
