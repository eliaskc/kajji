import { describe, expect, test } from "bun:test"
import { untrackedLargeFilesWarning } from "../../../src/utils/untracked-large-files"

const big = { path: "big.bin", size: 2000000, maxSize: 1048576 }
const clip = { path: "assets/clip.mov", size: 3145728, maxSize: 1048576 }

describe("untrackedLargeFilesWarning", () => {
    test("lists aligned sizes and names a single file in the track command", () => {
        const warning = untrackedLargeFilesWarning([{ ...big, path: "my big's.bin" }])
        expect(warning.message).toBe("Refused to snapshot: 1 new file over the 1.0 MiB limit")
        expect(warning.output).toContain("  my big's.bin  1.9 MiB")
        expect(warning.output).toContain("jj file track --include-ignored 'my big'\\''s.bin'")
    })

    test("uses a placeholder path for more than one file", () => {
        const warning = untrackedLargeFilesWarning([clip, big])
        expect(warning.message).toBe("Refused to snapshot: 2 new files over the 1.0 MiB limit")
        expect(warning.output).toContain("  assets/clip.mov  3.0 MiB\n  big.bin          1.9 MiB")
        expect(warning.output).toContain("jj file track --include-ignored <path>")
    })
})
