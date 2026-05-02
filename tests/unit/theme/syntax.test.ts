import { describe, expect, test } from "bun:test"
import { isSyntaxThemeName } from "../../../src/theme/syntax"

describe("isSyntaxThemeName", () => {
	test("accepts bundled syntax themes", () => {
		expect(isSyntaxThemeName("ayu-dark")).toBe(true)
		expect(isSyntaxThemeName("github-light")).toBe(true)
	})

	test("rejects unknown themes", () => {
		expect(isSyntaxThemeName("unknown")).toBe(false)
		expect(isSyntaxThemeName(null)).toBe(false)
	})
})
