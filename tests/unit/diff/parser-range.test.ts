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

import { fetchParsedDiffRange } from "../../../src/diff/parser"

describe("fetchParsedDiffRange", () => {
    test("calls execute with from/to revisions and paths", async () => {
        mockExecute.mockClear()
        mockExecute.mockResolvedValueOnce({
            stdout: "",
            stderr: "",
            exitCode: 0,
            success: true,
        })

        await fetchParsedDiffRange("feature@origin", "feature", {
            paths: ["src/app.ts"],
        })

        expect(mockExecute).toHaveBeenCalledWith(
            [
                "diff",
                "--from",
                "feature@origin",
                "--to",
                "feature",
                "--git",
                'file:"src/app.ts"',
            ],
            { cwd: undefined },
        )
    })
})
