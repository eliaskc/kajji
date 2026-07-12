import { describe, expect, test } from "bun:test"
import {
    isStaleWorkingCopyError,
    parseJjError,
} from "../../../src/utils/error-parser"

describe("stale working copy errors", () => {
    test("recognizes an unreadable working copy operation", () => {
        const message = "Error: Could not read working copy's operation."

        expect(isStaleWorkingCopyError(message)).toBe(true)
        expect(parseJjError(message).errorType).toBe("stale-working-copy")
        expect(parseJjError(message).fixCommand).toBe(
            "jj workspace update-stale",
        )
    })
})
