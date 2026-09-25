import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { makeApplicationClient } from "../../../src/application/client"
import { AppProcess, AppProcessLive, type ProcessResult } from "../../../src/process/app-process"
import { makeAppProcessFake } from "../../support/layers"

const options = { cwd: "/tmp/repository" }
const a = "a".repeat(40)
const b = "b".repeat(40)
const patch = `diff --git a/file.txt b/file.txt
index 1234567..7654321 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new
`
const result = (stdout: string): ProcessResult => ({
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: 1,
})

describe("detail loading", () => {
    test("revisits reuse prepared rows and descriptions without another command", async () => {
        const calls: string[][] = []
        const client = makeApplicationClient(
            makeAppProcessFake((command) => {
                calls.push([...command.args])
                return Effect.succeed(
                    result(
                        command.args[0] === "diff"
                            ? patch
                            : "subject\n---KAJJI_DETAILS_SEPARATOR---\nsubject\nbody",
                    ),
                )
            }),
        )
        try {
            const first = await client.jjPreparedDiff({ revision: a }, options)
            const details = await client.jjCommitDetails(a, options)
            await client.jjPreparedDiff({ revision: b }, options)
            await client.jjCommitDetails(b, options)
            expect(await client.jjPreparedDiff({ revision: a }, options)).toBe(first)
            expect(await client.jjCommitDetails(a, options)).toBe(details)
            expect(first[0]?.hunks[0]?.lines.map((line) => line.content)).toEqual([
                "old\n",
                "new\n",
            ])
            expect(details).toEqual({ subject: "subject", body: "body" })
            expect(calls).toHaveLength(4)
            expect(calls[0]).toContain(a)
        } finally {
            await client.dispose()
        }
    })

    test.each(["jjCommitDetails", "jjShowDescription"] as const)(
        "%s caches successful empty results but retries command failures",
        async (method) => {
            let calls = 0
            let fail = true
            const client = makeApplicationClient(
                makeAppProcessFake(() => {
                    calls++
                    return Effect.succeed(
                        fail
                            ? { ...result(""), exitCode: 1, stderr: "description read failed" }
                            : result(""),
                    )
                }),
            )
            try {
                await expect(client[method](a, options)).rejects.toMatchObject({
                    _tag: "JjCommandError",
                })
                fail = false
                const empty = await client[method](a, options)
                expect(empty).toEqual({ subject: "", body: "" })
                expect(await client[method](a, options)).toBe(empty)
                expect(calls).toBe(2)
            } finally {
                await client.dispose()
            }
        },
    )

    test("caches the styled placeholder for an undescribed commit", async () => {
        let calls = 0
        const client = makeApplicationClient(
            makeAppProcessFake(() => {
                calls++
                return Effect.succeed(
                    result("(empty) (no description set)\n---KAJJI_DETAILS_SEPARATOR---\n"),
                )
            }),
        )
        try {
            const details = await client.jjCommitDetails(a, options)
            expect(details).toEqual({ subject: "(empty) (no description set)", body: "" })
            expect(await client.jjCommitDetails(a, options)).toBe(details)
            expect(calls).toBe(1)
        } finally {
            await client.dispose()
        }
    })

    test("shares concurrent prepared reads and isolates options and repositories", async () => {
        let calls = 0
        const client = makeApplicationClient(
            makeAppProcessFake(() => {
                calls++
                return Effect.succeed(result(patch))
            }),
        )
        try {
            const target = { revision: a }
            const [first, second] = await Promise.all([
                client.jjPreparedDiff(target, options),
                client.jjPreparedDiff(target, options),
            ])
            expect(first).toBe(second)
            expect(calls).toBe(1)
            await client.jjPreparedDiff(target, { ...options, paths: ["file.txt"] })
            await client.jjPreparedDiff(target, { cwd: "/tmp/another-repository" })
            await client.jjDiff(target, { ...options, color: true, columns: 80 })
            await client.jjDiff(target, { ...options, color: true, columns: 100 })
            await client.jjDiff(target, { ...options, color: true, columns: 80 })
            expect(calls).toBe(5)
        } finally {
            await client.dispose()
        }
    })

    test("rereads mutable symbols and ranges; caches only fully resolved unions", async () => {
        let calls = 0
        const client = makeApplicationClient(
            makeAppProcessFake(() => {
                calls++
                return Effect.succeed(result(String(calls)))
            }),
        )
        try {
            for (const target of [
                { revision: "@" },
                { revision: "mutable-change" },
                { from: "main@origin", to: "main" },
                { revision: `${a}::${b}` },
                { revision: `${a} | mutable-change` },
            ]) {
                const first = await client.jjDiff(target, options)
                expect(await client.jjDiff(target, options)).not.toBe(first)
            }
            const target = { revision: `${a} | ${b}` }
            const first = await client.jjDiff(target, options)
            expect(await client.jjDiff(target, options)).toBe(first)
            await client.invalidateDetailReads()
            expect(await client.jjDiff(target, options)).not.toBe(first)
        } finally {
            await client.dispose()
        }
    })

    test("shares file reads without retaining degraded binary metadata", async () => {
        let calls = 0
        const client = makeApplicationClient(
            makeAppProcessFake((command) => {
                calls++
                return Effect.succeed(
                    command.args.includes("--summary")
                        ? result("M file.txt\n")
                        : { ...result(""), exitCode: 1 },
                )
            }),
        )
        try {
            const [first, second] = await Promise.all([
                client.jjFiles({ revision: a }, options),
                client.jjFiles({ revision: a }, options),
            ])
            expect(first).toBe(second)
            expect(calls).toBe(2)
            await client.jjFiles({ revision: a }, options)
            expect(calls).toBe(4)
        } finally {
            await client.dispose()
        }
    })

    test("refresh and mutations invalidate completed reads", async () => {
        let calls = 0
        const client = makeApplicationClient(
            makeAppProcessFake(() => {
                calls++
                return Effect.succeed(result(String(calls)))
            }),
        )
        try {
            const target = { revision: a }
            const first = await client.jjDiff(target, options)
            await client.invalidateDetailReads()
            const refreshed = await client.jjDiff(target, options)
            expect(refreshed).not.toBe(first)
            await client.jjDescribe(a, "new subject", options)
            expect(await client.jjDiff(target, options)).not.toBe(refreshed)
        } finally {
            await client.dispose()
        }
    })

    test("failed prepared reads can be retried", async () => {
        let calls = 0
        const client = makeApplicationClient(
            makeAppProcessFake(() => {
                calls++
                return Effect.succeed(
                    calls === 1 ? { ...result(""), exitCode: 1, stderr: "failed" } : result(patch),
                )
            }),
        )
        try {
            await expect(client.jjPreparedDiff({ revision: a }, options)).rejects.toThrow()
            expect(await client.jjPreparedDiff({ revision: a }, options)).toHaveLength(1)
            expect(calls).toBe(2)
        } finally {
            await client.dispose()
        }
    })

    test("selection cancellation terminates and reaps a real detail child", async () => {
        const directory = await mkdtemp(join(tmpdir(), "kajji-detail-child-"))
        const ready = join(directory, "ready")
        const script = `process.on("SIGTERM", () => process.exit(0)); await Bun.write(${JSON.stringify(ready)}, String(process.pid)); await new Promise(() => {})`
        const client = makeApplicationClient(
            makeAppProcessFake((command) =>
                AppProcess.use((processService) =>
                    processService.run({
                        ...command,
                        executable: process.execPath,
                        args: ["-e", script],
                        cwd: directory,
                    }),
                ).pipe(Effect.provide(AppProcessLive)),
            ),
        )
        const controller = new AbortController()
        try {
            const pending = client
                .jjPreparedDiff(
                    { revision: a },
                    {
                        cwd: directory,
                        signal: controller.signal,
                    },
                )
                .catch((error: unknown) => error)
            let pid = 0
            const deadline = performance.now() + 3000
            while (!pid && performance.now() < deadline) {
                pid = Number(await readFile(ready, "utf8").catch(() => "0"))
                if (!pid) await Bun.sleep(5)
            }
            expect(pid).toBeGreaterThan(0)
            controller.abort()
            expect(await pending).toMatchObject({ name: "AbortError" })
            let alive = true
            while (alive && performance.now() < deadline) {
                try {
                    process.kill(pid, 0)
                } catch {
                    alive = false
                }
                if (alive) await Bun.sleep(5)
            }
            expect(alive).toBe(false)
        } finally {
            await client.dispose()
            await rm(directory, { recursive: true, force: true })
        }
    })

    test.each(["diff", "description", "files", "preview"] as const)(
        "aborting %s interrupts the process scope",
        async (kind) => {
            let started!: () => void
            let released!: () => void
            const ready = new Promise<void>((resolve) => {
                started = resolve
            })
            const reaped = new Promise<void>((resolve) => {
                released = resolve
            })
            const client = makeApplicationClient(
                makeAppProcessFake(() =>
                    Effect.scoped(
                        Effect.acquireRelease(Effect.sync(started), () =>
                            Effect.sync(released),
                        ).pipe(Effect.flatMap(() => Effect.never)),
                    ),
                ),
            )
            const controller = new AbortController()
            const readOptions = { ...options, signal: controller.signal }
            try {
                const pending = (
                    kind === "diff"
                        ? client.jjPreparedDiff({ revision: a }, readOptions)
                        : kind === "description"
                          ? client.jjCommitDetails(a, readOptions)
                          : kind === "files"
                            ? client.jjFiles({ revision: a }, readOptions)
                            : client.jjLogPage({ ...readOptions, revset: "all()" })
                ).catch((error: unknown) => error)
                await ready
                controller.abort()
                expect(await pending).toMatchObject({ name: "AbortError" })
                await reaped
            } finally {
                await client.dispose()
            }
        },
    )
})
