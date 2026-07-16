import { describe, expect, test } from "bun:test"
import {
    isStaleWorkingCopyFailure,
    parseJjError,
    shouldShowCriticalError,
} from "../../../src/utils/error-parser"

describe("stale working copy errors", () => {
    test("recognizes an unreadable working copy operation", () => {
        const message = "Error: Could not read working copy's operation."

        expect(
            isStaleWorkingCopyFailure({
                exitCode: 1,
                stdout: "",
                stderr: message,
            }),
        ).toBe(true)
        expect(parseJjError(message).errorType).toBe("stale-working-copy")
        expect(parseJjError(message).fixCommand).toBe(
            "jj workspace update-stale",
        )
    })

    test("requires a failed command result", () => {
        const output = {
            stdout: "The working copy is stale",
            stderr: "",
        }

        expect(isStaleWorkingCopyFailure({ ...output, exitCode: 0 })).toBe(
            false,
        )
        expect(isStaleWorkingCopyFailure({ ...output, exitCode: 1 })).toBe(true)
    })

    test("shows reconciliation even when repository data is already loaded", () => {
        expect(shouldShowCriticalError("The working copy is stale", true)).toBe(
            true,
        )
        expect(shouldShowCriticalError("unrecognized failure", true)).toBe(
            false,
        )
    })
})
