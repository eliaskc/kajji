import { describe, expect, test } from "bun:test"
import { parseLogOutput } from "../../../src/commander/log"

// Current template format (17 parts): gutter + MARKER + changeId + commitId
// + parentCommitIds + immutable + inTrunk + empty + divergent + conflict
// + description + author + email + authorTimestamp + committerTimestamp
// + bookmarks + workingCopies + refLine.

interface LogLineOptions {
    gutter?: string
    changeId?: string
    commitId?: string
    parents?: string
    immutable?: string
    inTrunk?: string
    empty?: string
    divergent?: string
    conflict?: string
    description?: string
    author?: string
    email?: string
    authorTimestamp?: string
    committerTimestamp?: string
    bookmarks?: string
    workingCopies?: string
    refLine?: string
}

function logLine(options: LogLineOptions = {}): string {
    const fields = [
        options.changeId ?? "abc123",
        options.commitId ?? "def456",
        options.parents ?? "",
        options.immutable ?? "false",
        options.inTrunk ?? "false",
        options.empty ?? "false",
        options.divergent ?? "false",
        options.conflict ?? "false",
        options.description ?? "commit description",
        options.author ?? "Author",
        options.email ?? "a@b.com",
        options.authorTimestamp ?? "2025-01-01 12:00:00",
        options.committerTimestamp ?? "2025-01-01 12:30:00",
        options.bookmarks ?? "",
        options.workingCopies ?? "",
    ]
    return `${options.gutter ?? "○  "}__LJ__${fields.join("__LJ__")}__LJ__${options.refLine ?? "abc123"}`
}

describe("parseLogOutput", () => {
    test("parses the full current template", () => {
        const output = logLine({
            gutter: "@  ",
            changeId: "abc123",
            commitId: "def456",
            parents: "parent123,parent456",
            conflict: "true",
            description: "feat: add feature",
            author: "John Doe",
            email: "john@example.com",
            authorTimestamp: "2025-01-01 12:00:00 +00:00",
            committerTimestamp: "2025-01-02 08:30:00 +00:00",
            bookmarks: "main,feature",
            workingCopies: "default",
            refLine: "abc123 refline",
        })

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
        expect(commit?.workingCopies).toEqual(["default"])
        expect(commit?.refLine).toBe("abc123 refline")
        expect(commit?.isWorkingCopy).toBe(true)
    })

    test("parses single commit with continuation line", () => {
        const output = `${logLine({
            description: "feat: add feature",
            author: "John Doe",
            email: "john@example.com",
            refLine: "abc123 user@email.com",
        })}
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

    test("parses conflict state", () => {
        const output = logLine({
            gutter: "@  ",
            parents: "parent123",
            conflict: "true",
            description: "conflicted commit",
        })

        const commits = parseLogOutput(output)

        expect(commits[0]?.parentCommitIds).toEqual(["parent123"])
        expect(commits[0]?.conflict).toBe(true)
        expect(commits[0]?.description).toBe("conflicted commit")
    })

    test("detects working copy from @ in gutter", () => {
        const output = logLine({ gutter: "@  ", description: "wip commit" })

        const commits = parseLogOutput(output)

        expect(commits[0]?.isWorkingCopy).toBe(true)
        expect(commits[0]?.description).toBe("wip commit")
    })

    test("parses immutable commit", () => {
        const output = logLine({
            gutter: "◆  ",
            immutable: "true",
            inTrunk: "true",
            description: "main commit",
        })

        const commits = parseLogOutput(output)

        expect(commits[0]?.immutable).toBe(true)
        expect(commits[0]?.inTrunk).toBe(true)
        expect(commits[0]?.description).toBe("main commit")
    })

    test("parses multiple commits", () => {
        const output = [
            logLine({ gutter: "@  ", description: "current work" }),
            logLine({
                changeId: "ghi789",
                commitId: "jkl012",
                description: "previous commit",
                refLine: "ghi789",
            }),
            "│  with description",
            logLine({
                gutter: "◆  ",
                changeId: "mno345",
                commitId: "pqr678",
                immutable: "true",
                inTrunk: "true",
                description: "root commit",
                refLine: "mno345",
            }),
        ].join("\n")

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
        const output = `${logLine({ description: "commit" })}

`
        const commits = parseLogOutput(output)
        expect(commits).toHaveLength(1)
        expect(commits[0]?.lines).toHaveLength(1)
        expect(commits[0]?.description).toBe("commit")
    })

    test("strips ANSI codes from metadata but preserves in display", () => {
        const output = logLine({
            gutter: "@  ",
            changeId: "\x1b[38;5;5mwzqtrynx\x1b[39m",
            commitId: "\x1b[38;5;4mcec3ab64\x1b[39m",
            description: "feat: test",
            refLine: "\x1b[1m\x1b[38;5;13mw\x1b[38;5;8mzqtrynx\x1b[39m",
        })

        const commits = parseLogOutput(output)

        expect(commits[0]?.changeId).toBe("wzqtrynx")
        expect(commits[0]?.commitId).toBe("cec3ab64")
        expect(commits[0]?.description).toBe("feat: test")
        expect(commits[0]?.lines[0]).toContain("@  ")
        expect(commits[0]?.lines[0]).toContain("\x1b[")
    })

    test("parses empty commit", () => {
        const output = logLine({
            gutter: "@  ",
            empty: "true",
            description: "\x1b[2m(empty)\x1b[0m test desc",
        })

        const commits = parseLogOutput(output)

        expect(commits[0]?.empty).toBe(true)
        expect(commits[0]?.description).toContain("(empty)")
    })

    test("parses bookmarks", () => {
        const output = logLine({
            description: "commit with bookmarks",
            bookmarks: "main,feature",
        })

        const commits = parseLogOutput(output)

        expect(commits[0]?.bookmarks).toEqual(["main", "feature"])
    })

    test("parses working copies", () => {
        const output = logLine({
            gutter: "@  ",
            description: "multi workspace",
            workingCopies: "default,secondary",
        })

        const commits = parseLogOutput(output)

        expect(commits[0]?.workingCopies).toEqual(["default", "secondary"])
    })
})
