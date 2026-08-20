import type { ProcessCompletion } from "../process/operation-result"

/** `step` is a named action that is not a shell command, so the log shows no `$` prompt. */
export type CommandKind = "jj" | "hook" | "shell" | "step" | "info"

export interface CommandObserver {
    start: (command: string, options?: { kind?: CommandKind }) => string
    append: (id: string, chunk: string) => void
    finish: (id: string, result: ProcessCompletion) => void
    skip: (message: string) => void
    info?: (message: string) => void
}
