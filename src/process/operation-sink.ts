import { Schema } from "effect"
import type {
    ProcessError,
    ProcessOutputStream,
    ProcessResult,
} from "./app-process"

export class OperationInterruptedError extends Schema.TaggedErrorClass<OperationInterruptedError>()(
    "OperationInterruptedError",
    {
        command: Schema.String,
    },
) {}

export type OperationFailure = ProcessError | OperationInterruptedError

export interface OperationSink {
    readonly start: (command: string, kind?: "jj" | "hook" | "shell") => void
    readonly output: (stream: ProcessOutputStream, chunk: string) => void
    readonly finish: (result: ProcessResult) => void
    readonly fail: (error: OperationFailure) => void
    readonly skip: (message: string) => void
}
