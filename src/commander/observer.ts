import type { ExecuteResult } from "./executor"

export type CommandKind = "jj" | "hook" | "shell" | "info"

export interface CommandObserver {
    start: (command: string, options?: { kind?: CommandKind }) => string
    append: (id: string, chunk: string) => void
    finish: (id: string, result: ExecuteResult) => void
    skip: (message: string) => void
    info?: (message: string) => void
}

export interface OperationRunOptions {
    observer?: CommandObserver
}
