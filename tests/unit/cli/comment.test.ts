import { describe, expect, mock, test } from "bun:test"

const mockFetchRevisions = mock(() => Promise.resolve([]))
const mockResolveRepoRoot = mock(() => Promise.resolve("/repo"))
const mockReadComments = mock(() => ({ version: 1, revisions: {} }))
const mockWriteComments = mock(() => {})

mock.module("../../../src/cli/revisions", () => ({
	fetchRevisions: mockFetchRevisions,
}))

mock.module("../../../src/comments/storage", () => ({
	resolveRepoRoot: mockResolveRepoRoot,
	readComments: mockReadComments,
	writeComments: mockWriteComments,
}))

import { commentCommand } from "../../../src/cli/comment"

describe("commentCommand list", () => {
	test("prints empty-state message when no comments", async () => {
		const logSpy = mock(() => {})
		const originalLog = console.log
		console.log = logSpy

		try {
			const subCommands = commentCommand.subCommands as {
				list?: { run?: (context: unknown) => Promise<void> | void }
			}
			const context = {
				args: { revisions: "@", json: false },
				rawArgs: [],
				cmd: commentCommand,
			}
			await subCommands.list?.run?.(context as unknown as never)
		} finally {
			console.log = originalLog
		}

		expect(logSpy).toHaveBeenCalledWith("No comments found")
	})
})
