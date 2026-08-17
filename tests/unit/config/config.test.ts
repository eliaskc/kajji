import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { migrateLegacyDiffEngine, migrateLegacyHooks } from "../../../src/config/config"

describe("config migration", () => {
    test("moves legacy hooks with onlyIn into matching repo config", () => {
        const migrated = migrateLegacyHooks({
            gitHooksPath: ".git/hooks",
            hooks: {
                "jj.new": {
                    onlyIn: "~/code/my-repo",
                    pre: ["bun test"],
                },
            },
        })

        expect(migrated).toEqual({
            gitHooksPath: ".git/hooks",
            repos: {
                "~/code/my-repo": {
                    hooks: {
                        "jj.new": {
                            pre: ["bun test"],
                        },
                    },
                },
            },
        })
    })

    test("moves legacy unscoped hooks into root repo config", () => {
        const migrated = migrateLegacyHooks({
            hooks: {
                "jj.new": {
                    pre: ["bun test"],
                },
            },
        })

        expect(migrated).toEqual({
            repos: {
                "/": {
                    hooks: {
                        "jj.new": {
                            pre: ["bun test"],
                        },
                    },
                },
            },
        })
    })

    test("preserves existing repo config when migrating legacy hooks", () => {
        const migrated = migrateLegacyHooks({
            hooks: {
                "jj.new": {
                    onlyIn: "~/code/my-repo",
                    pre: ["bun test"],
                },
            },
            repos: {
                "~/code/my-repo": {
                    gitHooksPath: ".githooks",
                },
            },
        })

        expect(migrated).toEqual({
            repos: {
                "~/code/my-repo": {
                    gitHooksPath: ".githooks",
                    hooks: {
                        "jj.new": {
                            pre: ["bun test"],
                        },
                    },
                },
            },
        })
    })
})

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

describe("legacy diff engine migration", () => {
    test("maps useJjFormatter: true to the jj-formatter engine", () => {
        const migrated = migrateLegacyDiffEngine({
            diff: { layout: "auto", useJjFormatter: true },
        })
        expect(migrated).toEqual({
            diff: { layout: "auto", engine: "jj-formatter" },
        })
    })

    test("drops useJjFormatter: false without changing the engine", () => {
        const migrated = migrateLegacyDiffEngine({
            diff: { useJjFormatter: false, engine: "structural" },
        })
        expect(migrated).toEqual({ diff: { engine: "structural" } })
    })

    test("keeps an explicit engine over useJjFormatter: true", () => {
        const migrated = migrateLegacyDiffEngine({
            diff: { useJjFormatter: true, engine: "textual" },
        })
        expect(migrated).toEqual({ diff: { engine: "textual" } })
    })

    test("returns the input unchanged when there is nothing to migrate", () => {
        const raw = { diff: { engine: "structural" } }
        expect(migrateLegacyDiffEngine(raw)).toBe(raw)
    })
})
