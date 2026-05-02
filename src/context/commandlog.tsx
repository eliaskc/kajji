import { createSignal } from "solid-js"
import type { CommandObserver } from "../commander/observer"
import type { OperationResult } from "../commander/operations"
import { createSimpleContext } from "./helper"

export type CommandLogStatus =
	| "running"
	| "success"
	| "failure"
	| "skipped"
	| "info"

export interface CommandLogEntry {
	id: string
	command?: string
	message?: string
	output: string
	status: CommandLogStatus
	exitCode?: number
	timestamp: Date
	completedAt?: Date
}

function combinedOutput(
	result: Pick<OperationResult, "stdout" | "stderr">,
): string {
	return [result.stdout, result.stderr].filter(Boolean).join("")
}

export const { use: useCommandLog, provider: CommandLogProvider } =
	createSimpleContext({
		name: "CommandLog",
		init: () => {
			const [entries, setEntries] = createSignal<CommandLogEntry[]>([])

			const start = (command: string): string => {
				const id = crypto.randomUUID()
				setEntries((prev) => [
					...prev,
					{ id, command, output: "", status: "running", timestamp: new Date() },
				])
				return id
			}

			const append = (id: string, chunk: string) => {
				setEntries((prev) =>
					prev.map((entry) =>
						entry.id === id
							? { ...entry, output: entry.output + chunk }
							: entry,
					),
				)
			}

			const finish = (id: string, result: OperationResult) => {
				setEntries((prev) =>
					prev.map((entry) =>
						entry.id === id
							? {
									...entry,
									output: entry.output || combinedOutput(result),
									status: result.success ? "success" : "failure",
									exitCode: result.exitCode,
									completedAt: new Date(),
								}
							: entry,
					),
				)
			}

			const skip = (message: string) => {
				setEntries((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						message,
						output: "",
						status: "skipped",
						timestamp: new Date(),
					},
				])
			}

			const info = (message: string) => {
				setEntries((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						message,
						output: "",
						status: "info",
						timestamp: new Date(),
					},
				])
			}

			const addEntry = (result: OperationResult) => {
				if (result.logged) return
				const entry: CommandLogEntry = {
					id: crypto.randomUUID(),
					command: result.command,
					output: combinedOutput(result),
					status: result.success ? "success" : "failure",
					exitCode: result.exitCode,
					timestamp: new Date(),
					completedAt: new Date(),
				}
				setEntries((prev) => [...prev, entry])
			}

			const observer = (): CommandObserver => ({
				start: (command) => start(command),
				append,
				finish: (id, result) => finish(id, { ...result, command: "" }),
				skip,
				info,
			})

			const clear = () => {
				setEntries([])
			}

			const latest = () => entries().at(-1)

			return {
				entries,
				addEntry,
				start,
				append,
				finish,
				skip,
				info,
				observer,
				clear,
				latest,
			}
		},
	})
