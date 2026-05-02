import { describe, expect, test } from "bun:test"
import { ConfigSchema } from "../../../src/config/schema"

describe("ConfigSchema", () => {
	test("empty object gets all defaults", () => {
		const config = ConfigSchema.parse({})
		expect(config.ui.theme).toBe("kajji")
		expect(config.ui.themeMode).toBe("system")
		expect(config.ui.syntaxTheme).toEqual({})
		expect(config.diff.layout).toBe("auto")
		expect(config.diff.autoSwitchWidth).toBe(120)
		expect(config.diff.useJjFormatter).toBe(false)
		expect(config.ui.showFileTree).toBe(true)
		expect(config.whatsNewDisabled).toBe(false)
		expect(config.hooks).toEqual({})
	})

	test("partial config merges with defaults", () => {
		const config = ConfigSchema.parse({
			ui: {
				theme: "kajji",
				themeMode: "light",
				syntaxTheme: { dark: "ayu-dark", light: "github-light" },
			},
		})
		expect(config.ui.theme).toBe("kajji")
		expect(config.ui.themeMode).toBe("light")
		expect(config.ui.syntaxTheme).toEqual({
			dark: "ayu-dark",
			light: "github-light",
		})
		expect(config.diff.layout).toBe("auto")
		expect(config.ui.showFileTree).toBe(true)
	})

	test("partial nested config merges with defaults", () => {
		const config = ConfigSchema.parse({
			diff: { layout: "split" },
		})
		expect(config.diff.layout).toBe("split")
		expect(config.diff.autoSwitchWidth).toBe(120)
		expect(config.diff.useJjFormatter).toBe(false)
	})

	test("existing config with only whatsNewDisabled still works", () => {
		const config = ConfigSchema.parse({ whatsNewDisabled: true })
		expect(config.whatsNewDisabled).toBe(true)
		expect(config.ui.theme).toBe("kajji")
	})

	test("$schema field is preserved", () => {
		const config = ConfigSchema.parse({
			$schema: "https://kajji.sh/schema.json",
		})
		expect(config.$schema).toBe("https://kajji.sh/schema.json")
	})

	test("legacy theme names migrate to kajji", () => {
		for (const theme of ["lazygit", "opencode"]) {
			const config = ConfigSchema.parse({ ui: { theme } })
			expect(config.ui.theme).toBe("kajji")
		}
	})

	test("invalid theme rejects", () => {
		const result = ConfigSchema.safeParse({
			ui: { theme: "nonexistent" },
		})
		expect(result.success).toBe(false)
	})

	test("invalid syntax theme rejects", () => {
		const result = ConfigSchema.safeParse({
			ui: { syntaxTheme: { light: "not-a-theme" } },
		})
		expect(result.success).toBe(false)
	})

	test("invalid diff layout rejects", () => {
		const result = ConfigSchema.safeParse({
			diff: { layout: "side-by-side" },
		})
		expect(result.success).toBe(false)
	})

	test("negative autoSwitchWidth rejects", () => {
		const result = ConfigSchema.safeParse({
			diff: { autoSwitchWidth: -1 },
		})
		expect(result.success).toBe(false)
	})

	test("autoSwitchWidth 0 is valid (disables auto-switch)", () => {
		const config = ConfigSchema.parse({
			diff: { autoSwitchWidth: 0 },
		})
		expect(config.diff.autoSwitchWidth).toBe(0)
	})

	test("hooks can be configured for jj.new", () => {
		const config = ConfigSchema.parse({
			hooks: {
				"jj.new": {
					onlyIn: "~/sleepcycle/apnea/ios",
					pre: [
						"swiftlint lint . --config .swiftlint.yml --fix",
						{
							command:
								"swift format --configuration .swift-format --recursive . -i",
						},
					],
				},
			},
		})

		expect(config.hooks["jj.new"]?.pre).toHaveLength(2)
	})
})
