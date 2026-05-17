import { describe, expect, test } from "bun:test"
import { getUpdateCommand } from "../../../src/utils/update"

describe("getUpdateCommand", () => {
    test("returns versioned commands for JS package managers", () => {
        expect(getUpdateCommand("npm", "1.2.3")).toBe(
            "npm install -g kajji@1.2.3",
        )
        expect(getUpdateCommand("bun", "1.2.3")).toBe(
            "bun install -g kajji@1.2.3",
        )
        expect(getUpdateCommand("pnpm", "1.2.3")).toBe(
            "pnpm install -g kajji@1.2.3",
        )
        expect(getUpdateCommand("yarn", "1.2.3")).toBe(
            "yarn global add kajji@1.2.3",
        )
    })

    test("brew ignores the version arg (tap pins it)", () => {
        expect(getUpdateCommand("brew", "1.2.3")).toBe("brew upgrade kajji")
        expect(getUpdateCommand("brew", "9.9.9")).toBe("brew upgrade kajji")
    })

    test("curl uses the install script", () => {
        expect(getUpdateCommand("curl", "1.2.3")).toBe(
            "curl -fsSL https://kajji.sh/install.sh | bash",
        )
    })

    test("returns null for unknown", () => {
        expect(getUpdateCommand("unknown", "1.2.3")).toBeNull()
    })
})
