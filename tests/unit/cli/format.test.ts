import { describe, expect, test } from "bun:test"
import { formatLineRange } from "../../../src/cli/format"

describe("formatLineRange", () => {
	test("uses new line range when available", () => {
		expect(formatLineRange(10, 2, 20, 3)).toBe("20-22")
	})

	test("falls back to old line range when new count is zero", () => {
		expect(formatLineRange(5, 2, 10, 0)).toBe("5-6")
	})
})
