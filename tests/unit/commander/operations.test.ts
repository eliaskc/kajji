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

import {
	isImmutableError,
	jjAbandon,
	jjDescribe,
	jjEdit,
	jjSquash,
	parseOpLog,
} from "../../../src/commander/operations"

describe("parseOpLog", () => {
	test("parses single operation", () => {
		const lines = [
			"@  abc123def456 user@email.com 2025-01-01 12:00:00.000 +00:00 - 2025-01-01 12:00:01.000 +00:00",
			"│  describe commit abc123",
			"│  args: jj describe -m 'test'",
		]

		const result = parseOpLog(lines)

		expect(result).toHaveLength(1)
		expect(result[0]?.operationId).toBe("abc123def456")
		expect(result[0]?.isCurrent).toBe(true)
		expect(result[0]?.lines).toHaveLength(3)
	})

	test("parses multiple operations", () => {
		const lines = [
			"@  op1abc user@email.com 2025-01-01 12:00:00.000 +00:00",
			"│  first operation",
			"○  op2def user@email.com 2025-01-01 11:00:00.000 +00:00",
			"│  second operation",
			"○  op3ghi user@email.com 2025-01-01 10:00:00.000 +00:00",
			"   third operation",
		]

		const result = parseOpLog(lines)

		expect(result).toHaveLength(3)
		expect(result[0]?.operationId).toBe("op1abc")
		expect(result[0]?.isCurrent).toBe(true)
		expect(result[1]?.operationId).toBe("op2def")
		expect(result[1]?.isCurrent).toBe(false)
		expect(result[2]?.operationId).toBe("op3ghi")
		expect(result[2]?.isCurrent).toBe(false)
	})

	test("handles empty lines", () => {
		const lines = [
			"@  op1abc user@email.com 2025-01-01 12:00:00.000 +00:00",
			"",
		]

		const result = parseOpLog(lines)

		expect(result).toHaveLength(1)
		expect(result[0]?.lines).toHaveLength(1)
	})

	test("handles empty input", () => {
		const result = parseOpLog([])
		expect(result).toHaveLength(0)
	})

	test("strips ANSI codes from operation ID", () => {
		const lines = [
			"@  \x1b[38;5;5mop1abc\x1b[39m user@email.com 2025-01-01 12:00:00.000 +00:00",
		]

		const result = parseOpLog(lines)

		expect(result[0]?.operationId).toBe("op1abc")
	})
})

describe("isImmutableError", () => {
	test("returns true for lowercase immutable error", () => {
		const result = {
			success: false,
			stderr: "Error: Commit abc123 is immutable",
			stdout: "",
			exitCode: 1,
			command: "jj edit abc123",
		}

		expect(isImmutableError(result)).toBe(true)
	})

	test("returns true for uppercase Immutable error", () => {
		const result = {
			success: false,
			stderr: "Immutable commit cannot be modified",
			stdout: "",
			exitCode: 1,
			command: "jj describe abc123",
		}

		expect(isImmutableError(result)).toBe(true)
	})

	test("returns false for successful result", () => {
		const result = {
			success: true,
			stderr: "",
			stdout: "Working copy now at: abc123",
			exitCode: 0,
			command: "jj edit abc123",
		}

		expect(isImmutableError(result)).toBe(false)
	})

	test("returns false for success even with immutable in output", () => {
		const result = {
			success: true,
			stderr: "immutable mentioned but succeeded",
			stdout: "",
			exitCode: 0,
			command: "jj edit abc123",
		}

		expect(isImmutableError(result)).toBe(false)
	})

	test("returns false for other errors", () => {
		const result = {
			success: false,
			stderr: "Error: revision not found",
			stdout: "",
			exitCode: 1,
			command: "jj edit nonexistent",
		}

		expect(isImmutableError(result)).toBe(false)
	})
})

describe("jjEdit", () => {
	test("calls execute with correct arguments", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "Working copy now at: abc123",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjEdit("abc123")

		expect(mockExecute).toHaveBeenCalledWith(["edit", "abc123"])
	})

	test("adds --ignore-immutable when option is set", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "Working copy now at: abc123",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjEdit("abc123", { ignoreImmutable: true })

		expect(mockExecute).toHaveBeenCalledWith([
			"edit",
			"abc123",
			"--ignore-immutable",
		])
	})

	test("returns result with command string", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "Working copy now at: abc123",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		const result = await jjEdit("abc123")

		expect(result.command).toBe("jj edit abc123")
		expect(result.success).toBe(true)
	})
})

describe("jjDescribe", () => {
	test("calls execute with correct arguments", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjDescribe("abc123", "feat: new feature")

		expect(mockExecute).toHaveBeenCalledWith([
			"describe",
			"abc123",
			"-m",
			"feat: new feature",
		])
	})

	test("adds --ignore-immutable when option is set", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjDescribe("abc123", "feat: new feature", { ignoreImmutable: true })

		expect(mockExecute).toHaveBeenCalledWith([
			"describe",
			"abc123",
			"-m",
			"feat: new feature",
			"--ignore-immutable",
		])
	})

	test("returns result with sanitized command string", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		const result = await jjDescribe("abc123", "secret message")

		expect(result.command).toBe('jj describe abc123 -m "..."')
	})
})

describe("jjSquash", () => {
	test("calls execute with revision argument", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjSquash("abc123")

		expect(mockExecute).toHaveBeenCalledWith(["squash", "-r", "abc123"])
	})

	test("calls execute without revision when not provided", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjSquash()

		expect(mockExecute).toHaveBeenCalledWith(["squash"])
	})

	test("adds --ignore-immutable when option is set", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjSquash("abc123", { ignoreImmutable: true })

		expect(mockExecute).toHaveBeenCalledWith([
			"squash",
			"-r",
			"abc123",
			"--ignore-immutable",
		])
	})
})

describe("jjAbandon", () => {
	test("calls execute with correct arguments", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjAbandon("abc123")

		expect(mockExecute).toHaveBeenCalledWith(["abandon", "abc123"])
	})

	test("adds --ignore-immutable when option is set", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjAbandon("abc123", { ignoreImmutable: true })

		expect(mockExecute).toHaveBeenCalledWith([
			"abandon",
			"abc123",
			"--ignore-immutable",
		])
	})

	test("returns result with command string", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "Abandoned commit abc123",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		const result = await jjAbandon("abc123")

		expect(result.command).toBe("jj abandon abc123")
		expect(result.success).toBe(true)
	})
})
