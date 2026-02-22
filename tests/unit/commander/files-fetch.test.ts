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

import { fetchFiles } from "../../../src/commander/files"

describe("fetchFiles", () => {
	test("does not pass --ignore-working-copy (guard)", async () => {
		mockExecute.mockClear()
		mockExecute
			.mockResolvedValueOnce({
				stdout: "M src/app.ts",
				stderr: "",
				exitCode: 0,
				success: true,
			})
			.mockResolvedValueOnce({
				stdout: "",
				stderr: "",
				exitCode: 1,
				success: false,
			})

		const result = await fetchFiles("abc123")

		expect(mockExecute).toHaveBeenNthCalledWith(1, [
			"diff",
			"--summary",
			"-r",
			"abc123",
		])
		expect(mockExecute).toHaveBeenNthCalledWith(2, [
			"diff",
			"--git",
			"-r",
			"abc123",
		])
		expect(result).toEqual([
			{ path: "src/app.ts", status: "modified", isBinary: false },
		])
	})
})
