import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"

describe("JSONC parsing", () => {
	test("parses JSON with comments", () => {
		const input = `{
			// This is a comment
			"ui": { "theme": "kajji" }
		}`
		const result = parseJsonc(input)
		expect(result.ui.theme).toBe("kajji")
	})

	test("parses JSON with trailing commas", () => {
		const input = `{
			"ui": { "theme": "kajji", },
			"whatsNewDisabled": true,
		}`
		const result = parseJsonc(input)
		expect(result.ui.theme).toBe("kajji")
		expect(result.whatsNewDisabled).toBe(true)
	})

	test("parses JSON with block comments", () => {
		const input = `{
			/* Block comment */
			"diff": {
				"defaultMode": "split" /* inline comment */
			}
		}`
		const result = parseJsonc(input)
		expect(result.diff.defaultMode).toBe("split")
	})

	test("parses plain JSON (back-compat)", () => {
		const input = `{"whatsNewDisabled": true}`
		const result = parseJsonc(input)
		expect(result.whatsNewDisabled).toBe(true)
	})
})
