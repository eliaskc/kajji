import { describe, expect, test } from "bun:test"
import { resolveThemeMode } from "../../../src/theme/mode"

describe("resolveThemeMode", () => {
	test("uses explicit dark/light config", () => {
		expect(
			resolveThemeMode({
				configured: "dark",
				system: "light",
				terminalBgIsDark: false,
			}),
		).toBe("dark")
		expect(
			resolveThemeMode({
				configured: "light",
				system: "dark",
				terminalBgIsDark: true,
			}),
		).toBe("light")
	})

	test("system mode follows OpenTUI when available", () => {
		expect(
			resolveThemeMode({
				configured: "system",
				system: "light",
				terminalBgIsDark: true,
			}),
		).toBe("light")
	})

	test("system mode falls back to terminal background luminance", () => {
		expect(
			resolveThemeMode({
				configured: "system",
				system: null,
				terminalBgIsDark: false,
			}),
		).toBe("light")
		expect(
			resolveThemeMode({
				configured: "system",
				system: null,
				terminalBgIsDark: true,
			}),
		).toBe("dark")
	})
})
