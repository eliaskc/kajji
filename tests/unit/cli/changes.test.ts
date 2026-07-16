import { describe, expect, mock, test } from "bun:test"
import type { CliApplication } from "../../../src/cli/client"

import { makeChangesCommand } from "../../../src/cli/changes"

const application = {
    jjRevisionSummaries: () => Promise.resolve([]),
} as unknown as CliApplication
const changesCommand = makeChangesCommand(application)

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
