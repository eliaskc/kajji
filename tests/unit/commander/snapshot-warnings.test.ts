import { describe, expect, test } from "bun:test"
import {
    parseRefusedSnapshotFiles,
    stripRefusedSnapshotWarning,
} from "../../../src/commander/snapshot-warnings"

// jj 0.45 output, with the color codes jj adds to the header in user commands.
const WARNING = `\x1b[1m\x1b[38;5;3mWarning: \x1b[39mRefused to snapshot some files:\x1b[0m
  big.bin: 1.9MiB (2000000 bytes); the maximum size allowed is 1.0MiB (1048576 bytes)
  assets/video: clip.mov: 3.0MiB (3145728 bytes); the maximum size allowed is 1.0MiB (1048576 bytes)
Hint: This is to prevent large files from being added by accident. To fix this:
  * Add the file(s) to \`.gitignore\`
  * Run \`jj config set --repo snapshot.max-new-file-size 3145728\`
    This will increase the maximum file size allowed for new files, in this repository only.
`

describe("snapshot warnings", () => {
    test("parses refused files, including paths with colons, and ignores hint lines", () => {
        expect(parseRefusedSnapshotFiles(`Working copy now at: abc\n${WARNING}`)).toEqual([
            { path: "assets/video: clip.mov", size: 3145728, maxSize: 1048576 },
            { path: "big.bin", size: 2000000, maxSize: 1048576 },
        ])
    })

    test("strips the warning and its hint, and keeps other output", () => {
        const output = `Working copy  (@) now at: abc 123 (empty)\n${WARNING}Parent commit (@-): def 456\n`
        expect(stripRefusedSnapshotWarning(output)).toBe(
            "Working copy  (@) now at: abc 123 (empty)\nParent commit (@-): def 456\n",
        )
    })
})
