import { describe, expect, test } from "bun:test"
import { abbreviateHomePath } from "../../../src/utils/home-path"

describe("abbreviateHomePath", () => {
    test.each([
        ["/Users/me", "/Users/me", "~"],
        ["/Users/me/code/kajji", "/Users/me", "~/code/kajji"],
        ["/Users/me/code", "/Users/me/", "~/code"],
        ["/Users/meow/code", "/Users/me", "/Users/meow/code"],
        ["/tmp/repo", "/Users/me", "/tmp/repo"],
        ["/Users/me/code", undefined, "/Users/me/code"],
        ["/Users/me/code", "/", "/Users/me/code"],
        ["/Users/m.e/code", "/Users/m.e", "~/code"],
        ["/Users/mxe/code", "/Users/m.e", "/Users/mxe/code"],
    ])("%s with HOME=%s", (path, home, expected) => {
        expect(abbreviateHomePath(path, home)).toBe(expected)
    })
})
