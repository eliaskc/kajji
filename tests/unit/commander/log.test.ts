import { describe, expect, test } from "bun:test"
import { parseLogOutput } from "../../../src/commander/log"

// Current template format (18 parts): gutter + MARKER + changeId + commitId
// + parentCommitIds + immutable + inTrunk + empty + divergent + conflict
// + description + author + email + authorTimestamp + committerTimestamp
// + bookmarks + gitHead + workingCopies + refLine.
//
// Older fixtures below use reduced variants (15–17 parts) that the parser
// still supports; they omit committerTimestamp and some metadata fields.

describe("parseLogOutput", () => {
    test("parses the full current template", () => {
        const fields = [
            "abc123", // changeId
            "def456", // commitId
            "parent123,parent456", // parentCommitIds
            "false", // immutable
            "false", // inTrunk
            "false", // empty
            "false", // divergent
            "true", // conflict
            "feat: add feature", // description
            "John Doe", // author
            "john@example.com", // email
            "2025-01-01 12:00:00 +00:00", // author timestamp
            "2025-01-02 08:30:00 +00:00", // committer timestamp
            "main,feature", // bookmarks
            "true", // gitHead
            "default", // workingCopies
        ]
        const output = `@  __LJ__${fields.join("__LJ__")}__LJ__abc123 refline`

        const commits = parseLogOutput(output)

        expect(commits).toHaveLength(1)
        const commit = commits[0]
        expect(commit?.changeId).toBe("abc123")
        expect(commit?.commitId).toBe("def456")
        expect(commit?.parentCommitIds).toEqual(["parent123", "parent456"])
        expect(commit?.conflict).toBe(true)
        expect(commit?.description).toBe("feat: add feature")
        expect(commit?.author).toBe("John Doe")
        expect(commit?.authorEmail).toBe("john@example.com")
        expect(commit?.timestamp).toBe("2025-01-01 12:00:00 +00:00")
        expect(commit?.committerTimestamp).toBe("2025-01-02 08:30:00 +00:00")
        expect(commit?.bookmarks).toEqual(["main", "feature"])
        expect(commit?.gitHead).toBe(true)
        expect(commit?.workingCopies).toEqual(["default"])
        expect(commit?.refLine).toBe("abc123 refline")
        expect(commit?.isWorkingCopy).toBe(true)
    })

    test("parses single commit", () => {
        const output = `○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__false__LJ__feat: add feature__LJ__John Doe__LJ__john@example.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__abc123 user@email.com
│  description continues here`

        const commits = parseLogOutput(output)

        expect(commits).toHaveLength(1)
        expect(commits[0]?.changeId).toBe("abc123")
        expect(commits[0]?.commitId).toBe("def456")
        expect(commits[0]?.immutable).toBe(false)
        expect(commits[0]?.inTrunk).toBe(false)
        expect(commits[0]?.empty).toBe(false)
        expect(commits[0]?.divergent).toBe(false)
        expect(commits[0]?.conflict).toBe(false)
        expect(commits[0]?.isWorkingCopy).toBe(false)
        expect(commits[0]?.description).toBe("feat: add feature")
        expect(commits[0]?.author).toBe("John Doe")
        expect(commits[0]?.authorEmail).toBe("john@example.com")
        expect(commits[0]?.timestamp).toBe("2025-01-01 12:00:00")
        expect(commits[0]?.lines).toHaveLength(2)
    })

    test("parses conflict state from the current template", () => {
        const output =
            "@  __LJ__abc123__LJ__def456__LJ__parent123__LJ__false__LJ__false__LJ__false__LJ__false__LJ__true__LJ__conflicted commit__LJ__Jane__LJ__jane@test.com__LJ__2025-01-02 10:00:00__LJ____LJ__false__LJ____LJ__abc123"

        const commits = parseLogOutput(output)

        expect(commits[0]?.parentCommitIds).toEqual(["parent123"])
        expect(commits[0]?.conflict).toBe(true)
        expect(commits[0]?.description).toBe("conflicted commit")
        expect(commits[0]?.committerTimestamp).toBeUndefined()
    })

    test("detects working copy from @ in gutter", () => {
        const output =
            "@  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__false__LJ__wip commit__LJ__Jane__LJ__jane@test.com__LJ__2025-01-02 10:00:00__LJ____LJ__false__LJ____LJ__abc123"

        const commits = parseLogOutput(output)

        expect(commits[0]?.isWorkingCopy).toBe(true)
        expect(commits[0]?.description).toBe("wip commit")
    })

    test("parses immutable commit", () => {
        const output =
            "◆  __LJ__abc123__LJ__def456__LJ__true__LJ__true__LJ__false__LJ__false__LJ__main commit__LJ__Admin__LJ__admin@test.com__LJ__2025-01-03 09:00:00__LJ____LJ__false__LJ____LJ__abc123"

        const commits = parseLogOutput(output)

        expect(commits[0]?.immutable).toBe(true)
        expect(commits[0]?.inTrunk).toBe(true)
        expect(commits[0]?.description).toBe("main commit")
    })

    test("parses multiple commits", () => {
        const output = `@  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__false__LJ__current work__LJ__User1__LJ__u1@test.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__abc123
○  __LJ__ghi789__LJ__jkl012__LJ__false__LJ__false__LJ__false__LJ__false__LJ__previous commit__LJ__User2__LJ__u2@test.com__LJ__2025-01-01 11:00:00__LJ____LJ__false__LJ____LJ__ghi789
│  with description
◆  __LJ__mno345__LJ__pqr678__LJ__true__LJ__true__LJ__false__LJ__false__LJ__root commit__LJ__User3__LJ__u3@test.com__LJ__2025-01-01 10:00:00__LJ____LJ__false__LJ____LJ__mno345`

        const commits = parseLogOutput(output)

        expect(commits).toHaveLength(3)
        expect(commits[0]?.changeId).toBe("abc123")
        expect(commits[0]?.isWorkingCopy).toBe(true)
        expect(commits[0]?.description).toBe("current work")
        expect(commits[1]?.changeId).toBe("ghi789")
        expect(commits[1]?.lines).toHaveLength(2)
        expect(commits[1]?.description).toBe("previous commit")
        expect(commits[2]?.changeId).toBe("mno345")
        expect(commits[2]?.immutable).toBe(true)
    })

    test("handles empty output", () => {
        const commits = parseLogOutput("")
        expect(commits).toHaveLength(0)
    })

    test("handles output with only whitespace lines", () => {
        const output = `○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__false__LJ__commit__LJ__Author__LJ__a@b.com__LJ__2025-01-01 00:00:00__LJ____LJ__false__LJ____LJ__abc123

`
        const commits = parseLogOutput(output)
        expect(commits).toHaveLength(1)
        expect(commits[0]?.lines).toHaveLength(1)
        expect(commits[0]?.description).toBe("commit")
    })

    test("strips ANSI codes from metadata but preserves in display", () => {
        const output =
            "@  __LJ__\x1b[38;5;5mwzqtrynx\x1b[39m__LJ__\x1b[38;5;4mcec3ab64\x1b[39m__LJ__false__LJ__false__LJ__false__LJ__false__LJ__feat: test__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__\x1b[1m\x1b[38;5;13mw\x1b[38;5;8mzqtrynx\x1b[39m"

        const commits = parseLogOutput(output)

        expect(commits[0]?.changeId).toBe("wzqtrynx")
        expect(commits[0]?.commitId).toBe("cec3ab64")
        expect(commits[0]?.description).toBe("feat: test")
        expect(commits[0]?.lines[0]).toContain("@  ")
        expect(commits[0]?.lines[0]).toContain("\x1b[")
    })

    test("parses empty commit", () => {
        const output =
            "@  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__true__LJ__false__LJ__\x1b[2m(empty)\x1b[0m test desc__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__abc123"

        const commits = parseLogOutput(output)

        expect(commits[0]?.empty).toBe(true)
        expect(commits[0]?.description).toContain("(empty)")
    })

    test("parses bookmarks", () => {
        const output =
            "○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__false__LJ__commit with bookmarks__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ__main,feature__LJ__false__LJ____LJ__abc123"

        const commits = parseLogOutput(output)

        expect(commits[0]?.bookmarks).toEqual(["main", "feature"])
    })

    test("parses git head", () => {
        const output =
            "○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__false__LJ__git head commit__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__true__LJ____LJ__abc123"

        const commits = parseLogOutput(output)

        expect(commits[0]?.gitHead).toBe(true)
    })

    test("parses working copies", () => {
        const output =
            "@  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__false__LJ__multi workspace__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ__default,secondary__LJ__abc123"

        const commits = parseLogOutput(output)

        expect(commits[0]?.workingCopies).toEqual(["default", "secondary"])
    })
})
