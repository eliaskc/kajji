import { describe, expect, mock, test } from "bun:test"

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

import { fetchDiff } from "../../../src/commander/diff"

describe("fetchDiff", () => {
	test("returns diff output on success", async () => {
		const diffOutput = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
+new line
 existing line`

		mockExecute.mockResolvedValueOnce({
			stdout: diffOutput,
			stderr: "",
			exitCode: 0,
			success: true,
		})

		const result = await fetchDiff("abc123")

		expect(result).toBe(diffOutput)
	})

	test("throws error when jj diff fails", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "Error: revision not found",
			exitCode: 1,
			success: false,
		})

		await expect(fetchDiff("nonexistent")).rejects.toThrow(
			"jj diff failed: Error: revision not found",
		)
	})

	test("throws error with stderr content in message", async () => {
		const errorMessage = "No such revision: xyz789"
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: errorMessage,
			exitCode: 1,
			success: false,
		})

		await expect(fetchDiff("xyz789")).rejects.toThrow(errorMessage)
	})

	test("calls execute with correct arguments", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "diff output",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await fetchDiff("testchange")

		expect(mockExecute).toHaveBeenCalledWith(
			["diff", "-r", "testchange", "--color", "always"],
			{ cwd: undefined, env: {} },
		)
	})

	test("passes cwd option to execute", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "diff output",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await fetchDiff("abc123", { cwd: "/custom/path" })

		expect(mockExecute).toHaveBeenCalledWith(
			["diff", "-r", "abc123", "--color", "always"],
			{ cwd: "/custom/path", env: {} },
		)
	})

	test("passes COLUMNS env var when columns option is set", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "diff output",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await fetchDiff("abc123", { columns: 80 })

		expect(mockExecute).toHaveBeenCalledWith(
			["diff", "-r", "abc123", "--color", "always"],
			{ cwd: undefined, env: { COLUMNS: "80" } },
		)
	})

	test("handles empty diff output", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		const result = await fetchDiff("emptychange")

		expect(result).toBe("")
	})

	test("handles diff with ANSI color codes", async () => {
		const coloredDiff = `\x1b[1mdiff --git a/file.ts b/file.ts\x1b[0m
\x1b[32m+new line\x1b[0m
\x1b[31m-old line\x1b[0m`

		mockExecute.mockResolvedValueOnce({
			stdout: coloredDiff,
			stderr: "",
			exitCode: 0,
			success: true,
		})

		const result = await fetchDiff("colorchange")

		expect(result).toBe(coloredDiff)
		expect(result).toContain("\x1b[")
	})

	test("passes single path to execute with fileset format", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "diff output",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await fetchDiff("abc123", { paths: ["src/file.ts"] })

		expect(mockExecute).toHaveBeenCalledWith(
			["diff", "-r", "abc123", "--color", "always", 'file:"src/file.ts"'],
			{ cwd: undefined, env: {} },
		)
	})

	test("passes multiple paths to execute with fileset format", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "diff output",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await fetchDiff("abc123", { paths: ["src/a.ts", "src/b.ts", "src/c.ts"] })

		expect(mockExecute).toHaveBeenCalledWith(
			[
				"diff",
				"-r",
				"abc123",
				"--color",
				"always",
				'file:"src/a.ts"',
				'file:"src/b.ts"',
				'file:"src/c.ts"',
			],
			{ cwd: undefined, env: {} },
		)
	})
})
