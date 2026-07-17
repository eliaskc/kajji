import { describe, expect, test } from "bun:test"
import { parseOpLog } from "../../../src/commander/op-log"

describe("parseOpLog", () => {
    test("parses single operation", () => {
        const lines = [
            "@  abc123def456 user@email.com 2025-01-01 12:00:00.000 +00:00 - 2025-01-01 12:00:01.000 +00:00",
            "│  describe commit abc123",
            "│  args: jj describe -m 'test'",
        ]

        const result = parseOpLog(lines)

        expect(result).toHaveLength(1)
        expect(result[0]?.operationId).toBe("abc123def456")
        expect(result[0]?.isCurrent).toBe(true)
        expect(result[0]?.lines).toHaveLength(3)
    })

    test("parses multiple operations", () => {
        const lines = [
            "@  op1abc user@email.com 2025-01-01 12:00:00.000 +00:00",
            "│  first operation",
            "○  op2def user@email.com 2025-01-01 11:00:00.000 +00:00",
            "│  second operation",
            "○  op3ghi user@email.com 2025-01-01 10:00:00.000 +00:00",
            "   third operation",
        ]

        const result = parseOpLog(lines)

        expect(result).toHaveLength(3)
        expect(result[0]?.operationId).toBe("op1abc")
        expect(result[0]?.isCurrent).toBe(true)
        expect(result[1]?.operationId).toBe("op2def")
        expect(result[1]?.isCurrent).toBe(false)
        expect(result[2]?.operationId).toBe("op3ghi")
        expect(result[2]?.isCurrent).toBe(false)
    })

    test("handles empty lines and input", () => {
        const lines = [
            "@  op1abc user@email.com 2025-01-01 12:00:00.000 +00:00",
            "",
        ]

        expect(parseOpLog(lines)[0]?.lines).toHaveLength(1)
        expect(parseOpLog([])).toEqual([])
    })

    test("strips ANSI codes from operation IDs", () => {
        const result = parseOpLog([
            "@  \x1b[38;5;5mop1abc\x1b[39m user@email.com 2025-01-01 12:00:00.000 +00:00",
        ])

        expect(result[0]?.operationId).toBe("op1abc")
    })
})
