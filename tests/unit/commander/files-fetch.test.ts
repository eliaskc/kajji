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

import { fetchFiles, fetchFilesRange } from "../../../src/commander/files"

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

    test("does not treat successful diff contents as a stale working copy error", async () => {
        mockExecute.mockClear()
        mockExecute
            .mockResolvedValueOnce({
                stdout: "M src/error.ts",
                stderr: "",
                exitCode: 0,
                success: true,
            })
            .mockResolvedValueOnce({
                stdout: '+const message = "The working copy is stale"',
                stderr: "",
                exitCode: 0,
                success: true,
            })

        await expect(fetchFiles("abc123")).resolves.toEqual([
            { path: "src/error.ts", status: "modified", isBinary: false },
        ])
    })

    test("fetchFilesRange calls execute with from and to revisions", async () => {
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
                exitCode: 0,
                success: true,
            })

        const result = await fetchFilesRange("feature@origin", "feature")

        expect(mockExecute).toHaveBeenNthCalledWith(1, [
            "diff",
            "--summary",
            "--from",
            "feature@origin",
            "--to",
            "feature",
        ])
        expect(mockExecute).toHaveBeenNthCalledWith(2, [
            "diff",
            "--git",
            "--from",
            "feature@origin",
            "--to",
            "feature",
        ])
        expect(result).toEqual([
            { path: "src/app.ts", status: "modified", isBinary: false },
        ])
    })
})
