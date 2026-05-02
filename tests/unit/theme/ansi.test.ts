import { describe, expect, test } from "bun:test"
import { resolveAnsiForeground } from "../../../src/theme/ansi"

const lightArgs = {
	mode: "light" as const,
	text: "#4f4f4f",
	textMuted: "#7a7a7a",
}

describe("resolveAnsiForeground", () => {
	test("uses theme text for missing/default foreground", () => {
		expect(resolveAnsiForeground({ ...lightArgs, fg: null })).toBe("#4f4f4f")
		expect(
			resolveAnsiForeground({
				...lightArgs,
				fg: null,
				defaultFg: "#f5f5f5",
			}),
		).toBe("#f5f5f5")
	})

	test("remaps light ANSI whites in light mode", () => {
		for (const fg of ["#ffffff", "#eeeeee", "#eaeaea", "#c5c8c6"]) {
			expect(resolveAnsiForeground({ ...lightArgs, fg })).toBe("#4f4f4f")
		}
	})

	test("remaps muted ANSI grays in light mode", () => {
		for (const fg of ["#666666", "#808080"]) {
			expect(resolveAnsiForeground({ ...lightArgs, fg })).toBe("#7a7a7a")
		}
	})

	test("preserves explicit colors in dark mode", () => {
		expect(
			resolveAnsiForeground({
				fg: "#eaeaea",
				mode: "dark",
				text: "#bfbdb6",
				textMuted: "#808080",
			}),
		).toBe("#eaeaea")
	})
})
