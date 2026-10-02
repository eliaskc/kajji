import { describe, expect, test } from "bun:test"
import {
    isImmutableError,
    isStaleWorkingCopyFailure,
    parseJjError,
    shouldShowCriticalError,
} from "../../../src/utils/error-parser"

describe("operation errors", () => {
    const result = (success: boolean, stderr: string) => ({
        success,
        stderr,
        stdout: "",
        exitCode: success ? 0 : 1,
        command: "jj edit abc123",
    })

    test("recognizes immutable command failures", () => {
        expect(isImmutableError(result(false, "commit is immutable"))).toBe(true)
        expect(isImmutableError(result(false, "Immutable commit"))).toBe(true)
        expect(isImmutableError(result(true, "immutable warning"))).toBe(false)
        expect(isImmutableError(result(false, "revision not found"))).toBe(false)
    })
})

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
        expect(parseJjError(message).fixCommand).toBe("jj workspace update-stale")
    })

    test("requires a failed command result", () => {
        const output = {
            stdout: "The working copy is stale",
            stderr: "",
        }

        expect(isStaleWorkingCopyFailure({ ...output, exitCode: 0 })).toBe(false)
        expect(isStaleWorkingCopyFailure({ ...output, exitCode: 1 })).toBe(true)
    })

    test("shows reconciliation even when repository data is already loaded", () => {
        expect(shouldShowCriticalError("The working copy is stale", true)).toBe(true)
        expect(shouldShowCriticalError("unrecognized failure", true)).toBe(false)
    })
})

describe("unknown errors", () => {
    test("keeps the cause chain as details", () => {
        const parsed = parseJjError(
            [
                "Internal error: Unexpected error from backend",
                "Caused by:",
                "1: Could not write object of type commit",
                "2: Signing error",
                "Hint: Check your signing config",
                "",
            ].join("\n"),
        )

        expect(parsed.title).toBe("Internal error: Unexpected error from backend")
        expect(parsed.details).toEqual([
            "Caused by:",
            "1: Could not write object of type commit",
            "2: Signing error",
        ])
        expect(parsed.hints).toEqual(["Check your signing config"])
        expect(parsed.fixCommand).toBeNull()
    })
})
