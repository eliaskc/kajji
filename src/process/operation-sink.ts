import { Data } from "effect"
import type {
    ProcessError,
    ProcessOutputStream,
    ProcessResult,
} from "./app-process"

export class OperationInterruptedError extends Data.TaggedError(
    "OperationInterruptedError",
)<{
    readonly command: string
}> {}

export type OperationFailure = ProcessError | OperationInterruptedError

export interface OperationSink {
    readonly start: (command: string, kind?: "jj" | "hook") => void
    readonly output: (stream: ProcessOutputStream, chunk: string) => void
    readonly finish: (result: ProcessResult) => void
    readonly fail: (error: OperationFailure) => void
    readonly skip: (message: string) => void
}
