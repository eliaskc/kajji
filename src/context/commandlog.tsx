import { createSignal } from "solid-js"
import type { CommandKind, CommandObserver } from "../commander/observer"
import {
    type UntrackedLargeFile,
    parseRefusedSnapshotFiles,
    stripRefusedSnapshotWarning,
} from "../commander/snapshot-warnings"
import type { OperationResult } from "../process/operation-result"
import { createSimpleContext } from "./helper"

export type CommandLogStatus = "running" | "success" | "failure" | "skipped" | "info" | "warning"

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
        output.slice(-(MAX_COMMAND_LOG_OUTPUT_CHARS - TRUNCATED_OUTPUT_PREFIX.length))
    )
}

function limitEntries(entries: CommandLogEntry[]): CommandLogEntry[] {
    return entries.length <= MAX_COMMAND_LOG_ENTRIES
        ? entries
        : entries.slice(-MAX_COMMAND_LOG_ENTRIES)
}

function combinedOutput(result: Pick<OperationResult, "stdout" | "stderr">): string {
    return limitOutput([result.stdout, result.stderr].filter(Boolean).join(""))
}

export const { use: useCommandLog, provider: CommandLogProvider } = createSimpleContext({
    name: "CommandLog",
    init: () => {
        const [entries, setEntries] = createSignal<CommandLogEntry[]>([])

        // Commands that snapshot print jj's large-file warning. The log replaces that raw
        // block with kajji's own entry, which listeners add (see untracked-large-files-log).
        const largeFileListeners = new Set<(files: UntrackedLargeFile[]) => void>()
        const onRefusedSnapshotFiles = (listener: (files: UntrackedLargeFile[]) => void) => {
            largeFileListeners.add(listener)
            return () => largeFileListeners.delete(listener)
        }
        const takeRefusedSnapshotFiles = (output: string) => {
            const files = parseRefusedSnapshotFiles(output)
            return { output: stripRefusedSnapshotWarning(output), files }
        }
        const reportRefusedSnapshotFiles = (files: UntrackedLargeFile[]) => {
            if (files.length === 0) return
            for (const listener of largeFileListeners) listener(files)
        }

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
            const current = entries().find((entry) => entry.id === id)
            const { output, files } = takeRefusedSnapshotFiles(
                current?.output || combinedOutput(result),
            )
            setEntries((prev) =>
                prev.map((entry) =>
                    entry.id === id
                        ? {
                              ...entry,
                              output,
                              status: result.success ? "success" : "failure",
                              exitCode: result.exitCode,
                              completedAt: new Date(),
                          }
                        : entry,
                ),
            )
            reportRefusedSnapshotFiles(files)
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

        const warn = (message: string, output = "") => {
            setEntries((prev) =>
                limitEntries([
                    ...prev,
                    {
                        id: crypto.randomUUID(),
                        message,
                        output: limitOutput(output),
                        status: "warning",
                        timestamp: new Date(),
                    },
                ]),
            )
        }

        const addEntries = (newEntries: readonly CommandLogEntry[]) => {
            setEntries((prev) => limitEntries([...prev, ...newEntries]))
        }

        const addEntry = (result: OperationResult) => {
            if (result.logged) return
            const { output, files } = takeRefusedSnapshotFiles(combinedOutput(result))
            const entry: CommandLogEntry = {
                id: crypto.randomUUID(),
                command: result.command,
                output,
                status: result.success ? "success" : "failure",
                exitCode: result.exitCode,
                timestamp: new Date(),
                completedAt: new Date(),
            }
            setEntries((prev) => limitEntries([...prev, entry]))
            reportRefusedSnapshotFiles(files)
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
            addEntries,
            start,
            append,
            finish,
            skip,
            info,
            warn,
            onRefusedSnapshotFiles,
            observer,
            clear,
            latest,
        }
    },
})
