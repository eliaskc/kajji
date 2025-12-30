import { describe, expect, test } from "bun:test"
import { parseLogOutput } from "../../../src/commander/log"

describe("parseLogOutput", () => {
	test("parses single commit", () => {
		const output = `○  __LJ__abc123__LJ__def456__LJ__false__LJ__abc123 user@email.com feat: add feature
│  description continues here`

		const commits = parseLogOutput(output)

		expect(commits).toHaveLength(1)
		expect(commits[0]?.changeId).toBe("abc123")
		expect(commits[0]?.commitId).toBe("def456")
		expect(commits[0]?.immutable).toBe(false)
		expect(commits[0]?.isWorkingCopy).toBe(false)
		expect(commits[0]?.lines).toHaveLength(2)
	})

	test("detects working copy from @ in gutter", () => {
		const output = "@  __LJ__abc123__LJ__def456__LJ__false__LJ__abc123 wip commit"

		const commits = parseLogOutput(output)

		expect(commits[0]?.isWorkingCopy).toBe(true)
	})

	test("parses immutable commit", () => {
		const output = "◆  __LJ__abc123__LJ__def456__LJ__true__LJ__abc123 main commit"

		const commits = parseLogOutput(output)

		expect(commits[0]?.immutable).toBe(true)
	})

	test("parses multiple commits", () => {
		const output = `@  __LJ__abc123__LJ__def456__LJ__false__LJ__abc123 current work
○  __LJ__ghi789__LJ__jkl012__LJ__false__LJ__ghi789 previous commit
│  with description
◆  __LJ__mno345__LJ__pqr678__LJ__true__LJ__mno345 root commit`

		const commits = parseLogOutput(output)

		expect(commits).toHaveLength(3)
		expect(commits[0]?.changeId).toBe("abc123")
		expect(commits[0]?.isWorkingCopy).toBe(true)
		expect(commits[1]?.changeId).toBe("ghi789")
		expect(commits[1]?.lines).toHaveLength(2)
		expect(commits[2]?.changeId).toBe("mno345")
		expect(commits[2]?.immutable).toBe(true)
	})

	test("handles empty output", () => {
		const commits = parseLogOutput("")
		expect(commits).toHaveLength(0)
	})

	test("handles output with only whitespace lines", () => {
		const output = `○  __LJ__abc123__LJ__def456__LJ__false__LJ__abc123 commit

`
		const commits = parseLogOutput(output)
		expect(commits).toHaveLength(1)
		expect(commits[0]?.lines).toHaveLength(1)
	})
})
