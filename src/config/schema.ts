import { z } from "zod"
import { syntaxThemeNames } from "../theme/syntax"

const SCHEMA_URL = "https://kajji.sh/schema.json"

const ThemeSchema = z.preprocess(
	(value) => (value === "lazygit" || value === "opencode" ? "kajji" : value),
	z.enum(["kajji"]).default("kajji"),
)

export const UiSchema = z.object({
	theme: ThemeSchema.describe("Color theme"),
	themeMode: z
		.enum(["system", "dark", "light"])
		.default("system")
		.describe("Color mode: follow system/terminal, or force dark/light"),
	syntaxTheme: z
		.object({
			dark: z.enum(syntaxThemeNames).optional(),
			light: z.enum(syntaxThemeNames).optional(),
		})
		.default({})
		.describe("Override syntax highlighting themes for dark/light modes"),
	showFileTree: z
		.boolean()
		.default(true)
		.describe("Show files as tree (false for flat list)"),
})

export const DiffSchema = z.object({
	layout: z
		.enum(["auto", "unified", "split"])
		.default("auto")
		.describe(
			"Diff layout mode: auto switches based on autoSwitchWidth, unified/split are fixed",
		),
	autoSwitchWidth: z
		.number()
		.int()
		.min(0)
		.default(120)
		.describe(
			"Auto-switch to split view above this terminal width (only used when layout is auto)",
		),
	wrap: z.boolean().default(true).describe("Wrap long lines in diff view"),
	useJjFormatter: z
		.boolean()
		.default(false)
		.describe("Use jj's ui.diff-formatter output in the diff view"),
})

export const HookCommandSchema = z
	.union([
		z.string(),
		z.object({
			command: z.string().min(1).describe("Shell command to run"),
			env: z
				.record(z.string(), z.string())
				.optional()
				.describe("Environment variables for this command"),
		}),
	])
	.describe("Hook command")

export const HookSchema = z
	.object({
		onlyIn: z
			.string()
			.optional()
			.describe(
				"Only run this hook when the current repository is under this path",
			),
		pre: z
			.array(HookCommandSchema)
			.default([])
			.describe("Commands to run before the hooked operation"),
	})
	.describe("Command hook")

export const ConfigSchema = z
	.object({
		$schema: z
			.string()
			.optional()
			.describe("JSON Schema reference for editor autocomplete"),

		ui: UiSchema.optional()
			.default({
				theme: "kajji",
				themeMode: "system",
				syntaxTheme: {},
				showFileTree: true,
			})
			.describe("UI settings"),

		diff: DiffSchema.optional()
			.default({
				layout: "auto",
				autoSwitchWidth: 120,
				wrap: true,
				useJjFormatter: false,
			})
			.describe("Diff display settings"),

		hooks: z
			.record(z.string(), HookSchema)
			.default({})
			.describe("Hooks keyed by operation id, for example jj.new"),

		whatsNewDisabled: z
			.boolean()
			.default(false)
			.describe("Disable the what's new screen on updates"),
	})
	.describe("kajji configuration")

export type AppConfig = z.infer<typeof ConfigSchema>

export { SCHEMA_URL }
