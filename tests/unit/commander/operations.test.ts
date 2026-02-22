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
	jjRebase,
	jjShowDescription,
	jjShowDescriptionStyled,
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

	test("uses --from and --into when target is specified", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjSquash("abc123", { into: "def456" })

		expect(mockExecute).toHaveBeenCalledWith([
			"squash",
			"--from",
			"abc123",
			"--into",
			"def456",
		])
	})

	test("adds -u flag when useDestinationMessage is set", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjSquash("abc123", { into: "def456", useDestinationMessage: true })

		expect(mockExecute).toHaveBeenCalledWith([
			"squash",
			"--from",
			"abc123",
			"--into",
			"def456",
			"-u",
		])
	})

	test("adds -k flag when keepEmptied is set", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjSquash("abc123", { keepEmptied: true })

		expect(mockExecute).toHaveBeenCalledWith(["squash", "-r", "abc123", "-k"])
	})

	test("combines multiple options correctly", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjSquash("abc123", {
			into: "def456",
			useDestinationMessage: true,
			keepEmptied: true,
			ignoreImmutable: true,
		})

		expect(mockExecute).toHaveBeenCalledWith([
			"squash",
			"--from",
			"abc123",
			"--into",
			"def456",
			"-u",
			"-k",
			"--ignore-immutable",
		])
	})
})

describe("jjRebase", () => {
	test("calls execute with revision and destination", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjRebase("abc123", "def456")

		expect(mockExecute).toHaveBeenCalledWith([
			"rebase",
			"-r",
			"abc123",
			"-d",
			"def456",
		])
	})

	test("adds descendants and skip-emptied flags", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjRebase("abc123", "def456", {
			mode: "descendants",
			skipEmptied: true,
		})

		expect(mockExecute).toHaveBeenCalledWith([
			"rebase",
			"-s",
			"abc123",
			"-d",
			"def456",
			"--skip-emptied",
		])
	})

	test("uses insert-before mode and ignore immutable", async () => {
		mockExecute.mockResolvedValueOnce({
			stdout: "",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjRebase("abc123", "def456", {
			targetMode: "insertBefore",
			ignoreImmutable: true,
		})

		expect(mockExecute).toHaveBeenCalledWith([
			"rebase",
			"-r",
			"abc123",
			"-B",
			"def456",
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

describe("jjShowDescriptionStyled", () => {
	test("does not pass --ignore-working-copy (guard)", async () => {
		mockExecute.mockClear()
		mockExecute
			.mockResolvedValueOnce({
				stdout: "subject",
				stderr: "",
				exitCode: 0,
				success: true,
			})
			.mockResolvedValueOnce({
				stdout: "subject\n\nbody",
				stderr: "",
				exitCode: 0,
				success: true,
			})

		await jjShowDescriptionStyled("abc123")

		expect(mockExecute).toHaveBeenNthCalledWith(1, [
			"log",
			"-r",
			"abc123",
			"--no-graph",
			"--color",
			"always",
			"-T",
			expect.any(String),
		])
		expect(mockExecute).toHaveBeenNthCalledWith(2, [
			"log",
			"-r",
			"abc123",
			"--no-graph",
			"-T",
			"description",
		])
	})

	test("parses subject and body from multi-line description", async () => {
		mockExecute
			.mockResolvedValueOnce({
				stdout: "feat: add new feature",
				stderr: "",
				exitCode: 0,
				success: true,
			})
			.mockResolvedValueOnce({
				stdout:
					"feat: add new feature\n\nThis is the body.\nWith multiple lines.",
				stderr: "",
				exitCode: 0,
				success: true,
			})

		const result = await jjShowDescriptionStyled("abc123")

		expect(result.subject).toBe("feat: add new feature")
		expect(result.body).toBe("This is the body.\nWith multiple lines.")
	})

	test("returns empty body for single-line description", async () => {
		mockExecute
			.mockResolvedValueOnce({
				stdout: "fix: quick bugfix",
				stderr: "",
				exitCode: 0,
				success: true,
			})
			.mockResolvedValueOnce({
				stdout: "fix: quick bugfix",
				stderr: "",
				exitCode: 0,
				success: true,
			})

		const result = await jjShowDescriptionStyled("abc123")

		expect(result.subject).toBe("fix: quick bugfix")
		expect(result.body).toBe("")
	})

	test("handles empty description", async () => {
		mockExecute
			.mockResolvedValueOnce({
				stdout: "(no description set)",
				stderr: "",
				exitCode: 0,
				success: true,
			})
			.mockResolvedValueOnce({
				stdout: "",
				stderr: "",
				exitCode: 0,
				success: true,
			})

		const result = await jjShowDescriptionStyled("abc123")

		expect(result.subject).toBe("(no description set)")
		expect(result.body).toBe("")
	})

	test("preserves ANSI codes in styled subject", async () => {
		const styledSubject = "\x1b[33m(empty)\x1b[0m feat: something"
		mockExecute
			.mockResolvedValueOnce({
				stdout: styledSubject,
				stderr: "",
				exitCode: 0,
				success: true,
			})
			.mockResolvedValueOnce({
				stdout: "feat: something\n\nBody text",
				stderr: "",
				exitCode: 0,
				success: true,
			})

		const result = await jjShowDescriptionStyled("abc123")

		expect(result.subject).toBe(styledSubject)
		expect(result.body).toBe("Body text")
	})

	test("handles failed execute gracefully", async () => {
		mockExecute
			.mockResolvedValueOnce({
				stdout: "",
				stderr: "error",
				exitCode: 1,
				success: false,
			})
			.mockResolvedValueOnce({
				stdout: "",
				stderr: "error",
				exitCode: 1,
				success: false,
			})

		const result = await jjShowDescriptionStyled("nonexistent")

		expect(result.subject).toBe("")
		expect(result.body).toBe("")
	})
})

describe("jjShowDescription", () => {
	test("does not pass --ignore-working-copy (guard)", async () => {
		mockExecute.mockClear()
		mockExecute.mockResolvedValueOnce({
			stdout: "subject\n\nbody",
			stderr: "",
			exitCode: 0,
			success: true,
		})

		await jjShowDescription("abc123")

		expect(mockExecute).toHaveBeenCalledWith([
			"log",
			"-r",
			"abc123",
			"--no-graph",
			"-T",
			"description",
		])
	})
})
