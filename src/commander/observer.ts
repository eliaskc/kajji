import type { ProcessCompletion } from "../process/operation-result"

export type CommandKind = "jj" | "hook" | "shell" | "info"

export interface CommandObserver {
    start: (command: string, options?: { kind?: CommandKind }) => string
    append: (id: string, chunk: string) => void
    finish: (id: string, result: ProcessCompletion) => void
    skip: (message: string) => void
    info?: (message: string) => void
}
