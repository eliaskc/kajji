import { describe, expect, mock, test } from "bun:test"

const mockFetchRevisions = mock(() => Promise.resolve([]))

mock.module("../../../src/cli/revisions", () => ({
	fetchRevisions: mockFetchRevisions,
}))

import { changesCommand } from "../../../src/cli/changes"

describe("changesCommand", () => {
	test("prints empty-state message when no revisions", async () => {
		const logSpy = mock(() => {})
		const originalLog = console.log
		console.log = logSpy

		try {
			const context = {
				args: { revisions: "@", json: false, diff: false },
				rawArgs: [],
				cmd: changesCommand,
			}
			await changesCommand.run?.(context as unknown as never)
		} finally {
			console.log = originalLog
		}

		expect(logSpy).toHaveBeenCalledWith("No changes found")
	})
})
