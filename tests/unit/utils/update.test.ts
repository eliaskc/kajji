import { describe, expect, test } from "bun:test"
import { getUpdateCommand, isMiseInstallPath } from "../../../src/utils/update"

describe("isMiseInstallPath", () => {
    test("matches binaries under a mise installs dir", () => {
        expect(
            isMiseInstallPath(
                "/Users/a/.local/share/mise/installs/github-eliaskc-kajji/0.18.0/kajji",
            ),
        ).toBe(true)
        expect(isMiseInstallPath("C:\\Users\\a\\mise\\installs\\kajji\\kajji.exe")).toBe(true)
    })

    test("ignores other install locations", () => {
        expect(isMiseInstallPath("/Users/a/.kajji/bin/kajji")).toBe(false)
        expect(isMiseInstallPath("/opt/homebrew/Cellar/kajji/0.18.0/bin/kajji")).toBe(false)
        expect(isMiseInstallPath("/Users/a/projects/mise/kajji")).toBe(false)
    })
})

describe("getUpdateCommand", () => {
    test("returns versioned commands for JS package managers", () => {
        expect(getUpdateCommand("npm", "1.2.3")).toBe("npm install -g kajji@1.2.3")
        expect(getUpdateCommand("bun", "1.2.3")).toBe("bun install -g kajji@1.2.3")
        expect(getUpdateCommand("pnpm", "1.2.3")).toBe("pnpm install -g kajji@1.2.3")
        expect(getUpdateCommand("yarn", "1.2.3")).toBe("yarn global add kajji@1.2.3")
    })

    test("brew ignores the version arg (tap pins it)", () => {
        expect(getUpdateCommand("brew", "1.2.3")).toBe("brew upgrade kajji")
        expect(getUpdateCommand("brew", "9.9.9")).toBe("brew upgrade kajji")
    })

    test("mise upgrades the github backend tool", () => {
        expect(getUpdateCommand("mise", "1.2.3")).toBe("mise upgrade github:eliaskc/kajji")
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
