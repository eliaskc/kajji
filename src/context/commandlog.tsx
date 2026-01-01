import { createSignal } from "solid-js"
import type { OperationResult } from "../commander/operations"
import { createSimpleContext } from "./helper"

export interface CommandLogEntry {
	id: string
	command: string
	output: string
	success: boolean
	timestamp: Date
}

export const { use: useCommandLog, provider: CommandLogProvider } =
	createSimpleContext({
		name: "CommandLog",
		init: () => {
			const [entries, setEntries] = createSignal<CommandLogEntry[]>([])

			const addEntry = (result: OperationResult) => {
				const entry: CommandLogEntry = {
					id: crypto.randomUUID(),
					command: result.command,
					output: result.success
						? result.stdout.trim() || "Done"
						: result.stderr.trim() || result.stdout.trim() || "Failed",
					success: result.success,
					timestamp: new Date(),
				}
				setEntries((prev) => [...prev, entry])
			}

			const clear = () => {
				setEntries([])
			}

			const latest = () => entries().at(-1)

			return {
				entries,
				addEntry,
				clear,
				latest,
			}
		},
	})
