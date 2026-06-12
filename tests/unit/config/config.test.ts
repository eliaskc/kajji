import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { migrateLegacyHooks } from "../../../src/config/config"

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
