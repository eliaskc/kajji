import { createSignal } from "solid-js"
import type { CommandKind, CommandObserver } from "../commander/observer"
import type { OperationResult } from "../process/operation-result"
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
    kind?: CommandKind
    status: CommandLogStatus
    exitCode?: number
    timestamp: Date
    completedAt?: Date
}

const MAX_COMMAND_LOG_ENTRIES = 200
const MAX_COMMAND_LOG_OUTPUT_CHARS = 100_000
const TRUNCATED_OUTPUT_PREFIX = `[output truncated to last ${MAX_COMMAND_LOG_OUTPUT_CHARS.toLocaleString()} chars]\n`

function limitOutput(output: string): string {
    if (output.length <= MAX_COMMAND_LOG_OUTPUT_CHARS) return output
    return (
        TRUNCATED_OUTPUT_PREFIX +
        output.slice(
            -(MAX_COMMAND_LOG_OUTPUT_CHARS - TRUNCATED_OUTPUT_PREFIX.length),
        )
    )
}

function limitEntries(entries: CommandLogEntry[]): CommandLogEntry[] {
    return entries.length <= MAX_COMMAND_LOG_ENTRIES
        ? entries
        : entries.slice(-MAX_COMMAND_LOG_ENTRIES)
}

function combinedOutput(
    result: Pick<OperationResult, "stdout" | "stderr">,
): string {
    return limitOutput([result.stdout, result.stderr].filter(Boolean).join(""))
}

export const { use: useCommandLog, provider: CommandLogProvider } =
    createSimpleContext({
        name: "CommandLog",
        init: () => {
            const [entries, setEntries] = createSignal<CommandLogEntry[]>([])

            const start = (command: string, kind?: CommandKind): string => {
                const id = crypto.randomUUID()
                setEntries((prev) =>
                    limitEntries([
                        ...prev,
                        {
                            id,
                            command,
                            output: "",
                            kind,
                            status: "running",
                            timestamp: new Date(),
                        },
                    ]),
                )
                return id
            }

            const append = (id: string, chunk: string) => {
                setEntries((prev) =>
                    prev.map((entry) =>
                        entry.id === id
                            ? {
                                  ...entry,
                                  output: limitOutput(entry.output + chunk),
                              }
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
                                  output:
                                      entry.output || combinedOutput(result),
                                  status: result.success
                                      ? "success"
                                      : "failure",
                                  exitCode: result.exitCode,
                                  completedAt: new Date(),
                              }
                            : entry,
                    ),
                )
            }

            const skip = (message: string) => {
                setEntries((prev) =>
                    limitEntries([
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            message,
                            output: "",
                            status: "skipped",
                            timestamp: new Date(),
                        },
                    ]),
                )
            }

            const info = (message: string) => {
                setEntries((prev) =>
                    limitEntries([
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            message,
                            output: "",
                            status: "info",
                            timestamp: new Date(),
                        },
                    ]),
                )
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
                setEntries((prev) => limitEntries([...prev, entry]))
            }

            const observer = (): CommandObserver => ({
                start: (command, options) => start(command, options?.kind),
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
