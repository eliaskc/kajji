import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeApplicationClient } from "../../../src/application/client"
import type { CommandObserver } from "../../../src/commander/observer"
import {
    type ProcessResult,
    makeAppProcessFake,
} from "../../../src/process/app-process"

const success: ProcessResult = {
    stdout: "fetched\n",
    stderr: "warning\n",
    exitCode: 0,
    durationMs: 10,
}

describe("ApplicationClient", () => {
    test("adapts fetch to Promise behavior and logs exactly once", async () => {
        const events: string[] = []
        let completions = 0
        const observer: CommandObserver = {
            start: (command) => {
                events.push(`start:${command}`)
                return "fetch"
            },
            append: (_id, chunk) => events.push(`append:${chunk.trim()}`),
            finish: () => {
                completions++
                events.push("finish")
            },
            skip: () => {},
        }
        const layer = makeAppProcessFake((command) => {
            command.onOutput?.("stdout", success.stdout)
            command.onOutput?.("stderr", success.stderr)
            return Effect.succeed(success)
        })
        const client = makeApplicationClient(layer)

        const result = await client.jjGitFetch({
            cwd: "/tmp/repository",
            observer,
        })
        await client.dispose()

        expect(result).toMatchObject({
            stdout: success.stdout,
            stderr: success.stderr,
            exitCode: 0,
            command: "jj git fetch",
            success: true,
            logged: true,
        })
        expect(events).toEqual([
            "start:jj git fetch",
            "append:fetched",
            "append:warning",
            "finish",
        ])
        expect(completions).toBe(1)
    })

    test("routes push, undo, and redo through the supplied process", async () => {
        const commands: string[] = []
        const layer = makeAppProcessFake((command) => {
            commands.push(`${command.cwd}:jj ${command.args.join(" ")}`)
            return Effect.succeed(success)
        })
        const client = makeApplicationClient(layer)

        const push = await client.jjGitPush({
            cwd: "/tmp/push",
            bookmarks: ["main"],
            dryRun: true,
        })
        const undo = await client.jjUndo({ cwd: "/tmp/undo" })
        const redo = await client.jjRedo({ cwd: "/tmp/redo" })
        await client.dispose()

        expect(commands).toEqual([
            "/tmp/push:jj git push --bookmark main --dry-run",
            "/tmp/undo:jj undo",
            "/tmp/redo:jj redo",
        ])
        expect([push.command, undo.command, redo.command]).toEqual([
            "jj git push --bookmark main --dry-run",
            "jj undo",
            "jj redo",
        ])
    })

    test("preserves normal non-zero exits at the compatibility edge", async () => {
        const layer = makeAppProcessFake(() =>
            Effect.succeed({ ...success, exitCode: 1, stderr: "failed" }),
        )
        const client = makeApplicationClient(layer)

        const result = await client.jjGitFetch({ cwd: "/tmp/repository" })
        await client.dispose()

        expect(result).toMatchObject({
            exitCode: 1,
            success: false,
            stderr: "failed",
        })
    })

    test("dispose interrupts active operations and rejects new ones", async () => {
        let started!: () => void
        const startedPromise = new Promise<void>((resolve) => {
            started = resolve
        })
        let released = false
        const layer = makeAppProcessFake(() =>
            Effect.scoped(
                Effect.acquireRelease(
                    Effect.sync(() => started()),
                    () =>
                        Effect.sync(() => {
                            released = true
                        }),
                ).pipe(Effect.flatMap(() => Effect.never)),
            ),
        )
        let completions = 0
        const observer: CommandObserver = {
            start: () => "fetch",
            append: () => {},
            finish: (_id, result) => {
                completions++
                expect(result.stderr).toBe("Command cancelled")
            },
            skip: () => {},
        }
        const client = makeApplicationClient(layer)
        const operation = client.jjGitFetch({
            cwd: "/tmp/repository",
            observer,
        })

        await startedPromise
        await client.dispose()

        await expect(operation).rejects.toBeDefined()
        expect(released).toBe(true)
        expect(completions).toBe(1)
        await expect(
            client.jjGitFetch({ cwd: "/tmp/repository" }),
        ).rejects.toThrow("shutting down")
    })
})
