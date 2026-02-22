import { beforeEach, describe, expect, mock, test } from "bun:test"

const mockExecute = mock(() =>
	Promise.resolve({
		stdout: "",
		stderr: "",
		exitCode: 0,
		success: true,
	}),
)

mock.module("../../../src/commander/executor", () => ({
	execute: mockExecute,
}))

import { fetchLogPage, parseLogOutput } from "../../../src/commander/log"

beforeEach(() => {
	mockExecute.mockClear()
})

// Template format: gutter + MARKER + changeId + MARKER + commitId + MARKER + immutable + MARKER + empty + MARKER + divergent + MARKER + description + MARKER + author + MARKER + email + MARKER + timestamp + MARKER + bookmarks + MARKER + gitHead + MARKER + workingCopies + MARKER + refLine
// Total: 14 parts (13 markers)

describe("parseLogOutput", () => {
	test("parses single commit", () => {
		const output = `○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__feat: add feature__LJ__John Doe__LJ__john@example.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__abc123 user@email.com
│  description continues here`

		const commits = parseLogOutput(output)

		expect(commits).toHaveLength(1)
		expect(commits[0]?.changeId).toBe("abc123")
		expect(commits[0]?.commitId).toBe("def456")
		expect(commits[0]?.immutable).toBe(false)
		expect(commits[0]?.empty).toBe(false)
		expect(commits[0]?.divergent).toBe(false)
		expect(commits[0]?.isWorkingCopy).toBe(false)
		expect(commits[0]?.description).toBe("feat: add feature")
		expect(commits[0]?.author).toBe("John Doe")
		expect(commits[0]?.authorEmail).toBe("john@example.com")
		expect(commits[0]?.timestamp).toBe("2025-01-01 12:00:00")
		expect(commits[0]?.lines).toHaveLength(2)
	})

	test("detects working copy from @ in gutter", () => {
		const output =
			"@  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__wip commit__LJ__Jane__LJ__jane@test.com__LJ__2025-01-02 10:00:00__LJ____LJ__false__LJ____LJ__abc123"

		const commits = parseLogOutput(output)

		expect(commits[0]?.isWorkingCopy).toBe(true)
		expect(commits[0]?.description).toBe("wip commit")
	})

	test("parses immutable commit", () => {
		const output =
			"◆  __LJ__abc123__LJ__def456__LJ__true__LJ__false__LJ__false__LJ__main commit__LJ__Admin__LJ__admin@test.com__LJ__2025-01-03 09:00:00__LJ____LJ__false__LJ____LJ__abc123"

		const commits = parseLogOutput(output)

		expect(commits[0]?.immutable).toBe(true)
		expect(commits[0]?.description).toBe("main commit")
	})

	test("parses multiple commits", () => {
		const output = `@  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__current work__LJ__User1__LJ__u1@test.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__abc123
○  __LJ__ghi789__LJ__jkl012__LJ__false__LJ__false__LJ__false__LJ__previous commit__LJ__User2__LJ__u2@test.com__LJ__2025-01-01 11:00:00__LJ____LJ__false__LJ____LJ__ghi789
│  with description
◆  __LJ__mno345__LJ__pqr678__LJ__true__LJ__false__LJ__false__LJ__root commit__LJ__User3__LJ__u3@test.com__LJ__2025-01-01 10:00:00__LJ____LJ__false__LJ____LJ__mno345`

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
		const output = `○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__commit__LJ__Author__LJ__a@b.com__LJ__2025-01-01 00:00:00__LJ____LJ__false__LJ____LJ__abc123

`
		const commits = parseLogOutput(output)
		expect(commits).toHaveLength(1)
		expect(commits[0]?.lines).toHaveLength(1)
		expect(commits[0]?.description).toBe("commit")
	})

	test("strips ANSI codes from metadata but preserves in display", () => {
		const output =
			"@  __LJ__\x1b[38;5;5mwzqtrynx\x1b[39m__LJ__\x1b[38;5;4mcec3ab64\x1b[39m__LJ__false__LJ__false__LJ__false__LJ__feat: test__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__\x1b[1m\x1b[38;5;13mw\x1b[38;5;8mzqtrynx\x1b[39m"

		const commits = parseLogOutput(output)

		expect(commits[0]?.changeId).toBe("wzqtrynx")
		expect(commits[0]?.commitId).toBe("cec3ab64")
		expect(commits[0]?.description).toBe("feat: test")
		expect(commits[0]?.lines[0]).toContain("@  ")
		expect(commits[0]?.lines[0]).toContain("\x1b[")
	})

	test("parses empty commit", () => {
		const output =
			"@  __LJ__abc123__LJ__def456__LJ__false__LJ__true__LJ__false__LJ__\x1b[2m(empty)\x1b[0m test desc__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__abc123"

		const commits = parseLogOutput(output)

		expect(commits[0]?.empty).toBe(true)
		expect(commits[0]?.description).toContain("(empty)")
	})

	test("parses bookmarks", () => {
		const output =
			"○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__commit with bookmarks__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ__main,feature__LJ__false__LJ____LJ__abc123"

		const commits = parseLogOutput(output)

		expect(commits[0]?.bookmarks).toEqual(["main", "feature"])
	})

	test("parses git head", () => {
		const output =
			"○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__git head commit__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__true__LJ____LJ__abc123"

		const commits = parseLogOutput(output)

		expect(commits[0]?.gitHead).toBe(true)
	})

	test("parses working copies", () => {
		const output =
			"@  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__multi workspace__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ__default,secondary__LJ__abc123"

		const commits = parseLogOutput(output)

		expect(commits[0]?.workingCopies).toEqual(["default", "secondary"])
	})
})

describe("fetchLogPage", () => {
	test("uses limit + 1 to detect more results", async () => {
		const output =
			"○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__commit one__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__abc123\n" +
			"○  __LJ__ghi789__LJ__jkl012__LJ__false__LJ__false__LJ__false__LJ__commit two__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:01:00__LJ____LJ__false__LJ____LJ__ghi789\n" +
			"○  __LJ__mno345__LJ__pqr678__LJ__false__LJ__false__LJ__false__LJ__commit three__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:02:00__LJ____LJ__false__LJ____LJ__mno345"

		mockExecute.mockResolvedValueOnce({
			stdout: output,
			stderr: "",
			exitCode: 0,
			success: true,
		})

		const result = await fetchLogPage({ limit: 2 })

		expect(mockExecute).toHaveBeenCalledWith(
			[
				"log",
				"--color",
				"always",
				"--template",
				expect.any(String),
				"--limit",
				"3",
			],
			{ cwd: undefined },
		)
		expect(result.commits).toHaveLength(2)
		expect(result.hasMore).toBe(true)
	})

	test("does not set hasMore when result fits limit", async () => {
		const output =
			"○  __LJ__abc123__LJ__def456__LJ__false__LJ__false__LJ__false__LJ__commit one__LJ__Author__LJ__a@b.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__abc123"

		mockExecute.mockResolvedValueOnce({
			stdout: output,
			stderr: "",
			exitCode: 0,
			success: true,
		})

		const result = await fetchLogPage({ limit: 2 })

		expect(mockExecute).toHaveBeenCalledWith(
			[
				"log",
				"--color",
				"always",
				"--template",
				expect.any(String),
				"--limit",
				"3",
			],
			{ cwd: undefined },
		)
		expect(result.commits).toHaveLength(1)
		expect(result.hasMore).toBe(false)
	})
})
