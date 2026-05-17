import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { RevisionInfo } from "../../../src/cli/revisions"

type StoredRevision = {
    commitHash?: string
    anchors: Array<{
        type: string
        filePath?: string
        lineNumber?: number
        comments?: Array<unknown>
    }>
}

type CommentsStateLike = {
    version: number
    revisions: Record<string, StoredRevision>
}

const mockFetchRevisions = mock(() => Promise.resolve([] as RevisionInfo[]))
const mockResolveRepoRoot = mock(() => Promise.resolve("/repo"))
const mockReadComments = mock(() => ({ version: 2, revisions: {} }))
const mockWriteComments = mock(() => {})
const mockExecute = mock(() =>
    Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        success: true,
    }),
)

mock.module("../../../src/cli/revisions", () => ({
    fetchRevisions: mockFetchRevisions,
}))

mock.module("../../../src/comments/storage", () => ({
    resolveRepoRoot: mockResolveRepoRoot,
    readComments: mockReadComments,
    writeComments: mockWriteComments,
}))

mock.module("../../../src/commander/executor", () => ({
    execute: mockExecute,
}))

import { commentCommand } from "../../../src/cli/comment"

function getSubCommand(name: "list" | "set" | "delete") {
    const subCommands = commentCommand.subCommands as {
        list?: { run?: (context: unknown) => Promise<void> | void }
        set?: { run?: (context: unknown) => Promise<void> | void }
        delete?: { run?: (context: unknown) => Promise<void> | void }
    }
    return subCommands[name]
}

beforeEach(() => {
    mockFetchRevisions.mockClear()
    mockReadComments.mockClear()
    mockWriteComments.mockClear()
    mockExecute.mockClear()
    mockFetchRevisions.mockResolvedValue([])
    mockReadComments.mockReturnValue({ version: 2, revisions: {} })
    mockExecute.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        success: true,
    })
})

describe("commentCommand list", () => {
    test("prints empty-state message when no comments", async () => {
        const logSpy = mock(() => {})
        const originalLog = console.log
        console.log = logSpy

        try {
            const context = {
                args: { revisions: "@", json: false },
                rawArgs: [],
                cmd: commentCommand,
            }
            await getSubCommand("list")?.run?.(context as unknown as never)
        } finally {
            console.log = originalLog
        }

        expect(logSpy).toHaveBeenCalledWith("No comments found")
    })
})

describe("commentCommand set", () => {
    test("creates line anchor with --file/--line", async () => {
        mockFetchRevisions.mockResolvedValueOnce([
            { changeId: "abc123", commitId: "def456", description: "desc" },
        ])
        mockReadComments.mockReturnValueOnce({ version: 2, revisions: {} })
        mockExecute.mockResolvedValueOnce({
            stdout: "first\nsecond\nthird\n",
            stderr: "",
            exitCode: 0,
            success: true,
        })

        const logSpy = mock(() => {})
        const originalLog = console.log
        console.log = logSpy

        try {
            const context = {
                args: {
                    revisions: "@",
                    file: "src/app.ts",
                    line: "2",
                    message: "note",
                },
                rawArgs: [],
                cmd: commentCommand,
            }
            await getSubCommand("set")?.run?.(context as unknown as never)
        } finally {
            console.log = originalLog
        }

        expect(mockWriteComments).toHaveBeenCalledTimes(1)
        const calls = mockWriteComments.mock.calls as unknown as Array<
            [string, CommentsStateLike]
        >
        const payload = calls[calls.length - 1]?.[1]
        if (!payload) {
            throw new Error("Missing writeComments payload")
        }
        expect(payload.version).toBe(2)
        const revision = payload.revisions.abc123
        expect(revision?.anchors).toHaveLength(1)
        const anchor = revision?.anchors[0]
        expect(anchor?.type).toBe("line")
        expect(anchor?.filePath).toBe("src/app.ts")
        expect(anchor?.lineNumber).toBe(2)
        expect(anchor?.comments).toHaveLength(1)
    })
})

describe("commentCommand delete", () => {
    test("removes line anchor with --file/--line", async () => {
        mockFetchRevisions.mockResolvedValueOnce([
            { changeId: "abc123", commitId: "def456", description: "desc" },
        ])
        mockReadComments.mockReturnValueOnce({
            version: 2,
            revisions: {
                abc123: {
                    commitHash: "def456",
                    anchors: [
                        {
                            id: "l_1",
                            type: "line",
                            filePath: "src/app.ts",
                            lineNumber: 2,
                            contextLines: ["second"],
                            comments: [
                                {
                                    id: "cmt_1",
                                    text: "note",
                                    author: "human",
                                    type: "feedback",
                                    createdAt: "2025-01-01T00:00:00Z",
                                    replyTo: null,
                                },
                            ],
                        },
                    ],
                },
            },
        })

        const logSpy = mock(() => {})
        const originalLog = console.log
        console.log = logSpy

        try {
            const context = {
                args: {
                    revisions: "@",
                    file: "src/app.ts",
                    line: "2",
                },
                rawArgs: [],
                cmd: commentCommand,
            }
            await getSubCommand("delete")?.run?.(context as unknown as never)
        } finally {
            console.log = originalLog
        }

        const calls = mockWriteComments.mock.calls as unknown as Array<
            [string, CommentsStateLike]
        >
        const payload = calls[calls.length - 1]?.[1]
        if (!payload) {
            throw new Error("Missing writeComments payload")
        }
        expect(payload.revisions.abc123).toBeUndefined()
        expect(logSpy).toHaveBeenCalled()
    })
})
