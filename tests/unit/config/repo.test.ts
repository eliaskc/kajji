import { describe, expect, test } from "bun:test"
import { ConfigSchema, applyRepoConfig } from "../../../src/config"

describe("applyRepoConfig", () => {
    test("returns global config and empty hooks when no repo config matches", () => {
        const config = ConfigSchema.parse({
            gitHooksPath: ".git/hooks",
            repos: {
                "/tmp/my-repo": {
                    gitHooksPath: ".githooks",
                },
            },
        })

        const effective = applyRepoConfig(config, "/tmp/other-repo")

        expect(effective.gitHooksPath).toBe(".git/hooks")
        expect(effective.hooks).toEqual({})
    })

    test("overlays matching repo config over global config", () => {
        const config = ConfigSchema.parse({
            gitHooksPath: ".git/hooks",
            repos: {
                "/tmp/my-repo": {
                    gitHooksPath: ".githooks",
                    hooks: {
                        "jj.new": { pre: ["repo"] },
                    },
                },
            },
        })

        const effective = applyRepoConfig(config, "/tmp/my-repo/subdir")

        expect(effective.gitHooksPath).toBe(".githooks")
        expect(effective.hooks["jj.new"]?.pre).toEqual(["repo"])
    })

    test("uses the most specific matching repo config", () => {
        const config = ConfigSchema.parse({
            repos: {
                "/tmp": { gitHooksPath: ".git/hooks" },
                "/tmp/my-repo": { gitHooksPath: false },
            },
        })

        const effective = applyRepoConfig(config, "/tmp/my-repo")

        expect(effective.gitHooksPath).toBe(false)
    })
})
