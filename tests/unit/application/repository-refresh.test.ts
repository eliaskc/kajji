import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { makeApplicationClient } from "../../../src/application/client"
import { Jj } from "../../../src/commander/jj"
import {
    AppProcess,
    AppProcessLive,
    type ProcessCommand,
    type ProcessResult,
} from "../../../src/process/app-process"
import { JjLive, makeAppProcessFake } from "../../support/layers"

const result = (stdout: string): ProcessResult => ({
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: 1,
})
const options = { cwd: "/tmp/repository" }

describe("repository refresh", () => {
    test("uses one snapshot command and pins the working-copy read; unchanged polls use one command", async () => {
        const commands: ProcessCommand[] = []
        const client = makeApplicationClient(
            makeAppProcessFake((command) => {
                commands.push(command)
                return Effect.succeed(result(command.args[0] === "op" ? "operation-a" : "commit-a"))
            }),
        )
        try {
            const state = await client.jjRefreshState(options)
            expect(state).toEqual({ operationId: "operation-a", workingCopyCommitId: "commit-a" })
            expect(commands).toHaveLength(2)
            expect(commands[0]?.args).not.toContain("--ignore-working-copy")
            expect(commands[1]?.args.slice(-2)).toEqual(["--at-operation", "operation-a"])
            expect(await client.jjRefreshState({ ...options, previousState: state })).toEqual(state)
            expect(commands).toHaveLength(3)
            expect(commands[2]?.args[0]).toBe("op")
        } finally {
            await client.dispose()
        }
    })

    test("shares pending snapshots and cancels only after the final consumer leaves", async () => {
        let calls = 0
        let stopped = 0
        const started = Deferred.makeUnsafe<void>()
        const processLayer = makeAppProcessFake(() =>
            Effect.gen(function* () {
                calls++
                yield* Deferred.succeed(started, undefined)
                return yield* Effect.never
            }).pipe(
                Effect.ensuring(
                    Effect.sync(() => {
                        stopped++
                    }),
                ),
            ),
        )
        await Effect.runPromise(
            Effect.gen(function* () {
                const jj = yield* Jj
                const first = yield* jj.refreshState(options).pipe(Effect.forkScoped)
                yield* Deferred.await(started)
                const second = yield* jj.refreshState(options).pipe(Effect.forkScoped)
                yield* Effect.yieldNow
                yield* Fiber.interrupt(first)
                expect(calls).toBe(1)
                expect(stopped).toBe(0)
                yield* Fiber.interrupt(second)
                expect(stopped).toBe(1)
            }).pipe(Effect.scoped, Effect.provide(JjLive), Effect.provide(processLayer)),
        )
    })

    test("does not retain failed snapshots or hide failed working-copy reads", async () => {
        let failSnapshot = true
        let failCommit = false
        const client = makeApplicationClient(
            makeAppProcessFake((command) => {
                const fail = command.args[0] === "op" ? failSnapshot : failCommit
                return Effect.succeed(
                    fail ? { ...result(""), exitCode: 1, stderr: "read failed" } : result("id"),
                )
            }),
        )
        try {
            await expect(client.jjRefreshState(options)).rejects.toThrow()
            failSnapshot = false
            failCommit = true
            await expect(client.jjRefreshState(options)).rejects.toThrow()
            failCommit = false
            expect(await client.jjRefreshState(options)).toEqual({
                operationId: "id",
                workingCopyCommitId: "id",
            })
        } finally {
            await client.dispose()
        }
    })

    test("pins captured and streamed reads but never pins mutations", async () => {
        const commands: ProcessCommand[] = []
        const client = makeApplicationClient(
            makeAppProcessFake((command) => {
                commands.push(command)
                const output = command.stdoutFile
                if (output)
                    return Effect.promise(async () => {
                        await writeFile(output, "materialized text")
                        return result("")
                    })
                return Effect.succeed(result(command.args[0] === "root" ? options.cwd : ""))
            }),
        )
        try {
            const pinned = { ...options, atOperation: "operation-a" }
            await client.jjDiff({ revision: "@" }, { ...pinned, paths: ["--file.txt"] })
            await client.jjFiles({ revision: "@" }, pinned)
            await client.jjCommitDetails("@", pinned)
            await client.jjShowDescription("@", pinned)
            await client.jjRepositoryRoot(pinned)
            await client.jjRevisionSummaries("@", pinned)
            await client.jjFileContent("@", "file.txt", pinned)
            await client.jjIsInTrunk("@", pinned)
            await client.jjNearestAncestorBookmarkNames("@", pinned)
            await client.jjLogPage(pinned)
            await client.jjBookmarks(pinned)
            await client.jjStreamLogPage(pinned, () => {}).result
            await client.jjStreamBookmarks(pinned, () => {}).result
            await client.jjOpLog(10, pinned)
            const materialized = await client.jjMaterializeFiles("@", ["file.txt"], pinned)
            const otherView = await client.jjMaterializeFiles("@", ["file.txt"], {
                ...pinned,
                atOperation: "operation-b",
            })
            const otherRepo = await client.jjMaterializeFiles("@", ["file.txt"], {
                ...pinned,
                cwd: "/tmp/other-repo",
            })
            expect(materialized).not.toEqual(otherView)
            expect(materialized).not.toEqual(otherRepo)
            expect(commands.every((command) => command.args.includes("--at-operation"))).toBe(true)
            const readCount = commands.length
            await client.jjDescribe("@", "new description", pinned)
            await client.jjOpRestore("old-operation", pinned)
            await client.jjBookmarkSet("main", "@", pinned)
            await client.jjRestore(["file.txt"], pinned)
            expect(commands.slice(readCount)).toHaveLength(4)
            expect(
                commands
                    .slice(readCount)
                    .every((command) => !command.args.includes("--at-operation")),
            ).toBe(true)
            await client.jjDiff({ revision: "@" }, options)
            expect(commands.at(-1)?.args).not.toContain("--at-operation")
        } finally {
            await client.dispose()
        }
    })

    test("isolates symbolic details by operation but reuses immutable content", async () => {
        let calls = 0
        const client = makeApplicationClient(
            makeAppProcessFake((command) => {
                calls++
                return Effect.succeed(result(command.args.at(-1) ?? ""))
            }),
        )
        try {
            const first = { ...options, atOperation: "operation-a" }
            const second = { ...options, atOperation: "operation-b" }
            expect(
                await Promise.all([
                    client.jjDiff({ revision: "@" }, first),
                    client.jjDiff({ revision: "@" }, second),
                ]),
            ).toEqual(["operation-a", "operation-b"])
            expect(calls).toBe(2)
            const target = { revision: "a".repeat(40) }
            const content = await client.jjDiff(target, first)
            expect(await client.jjDiff(target, second)).toBe(content)
            expect(calls).toBe(3)
        } finally {
            await client.dispose()
        }
    })

    test("real snapshots detect edits, pin old views, and import colocated Git changes", async () => {
        const root = await mkdtemp(join(tmpdir(), "kajji-refresh-"))
        const config = join(root, "jj.toml")
        await writeFile(
            config,
            '[user]\nname="Refresh test"\nemail="refresh@example.com"\n[fsmonitor]\nbackend="none"\n',
        )
        const env = { ...process.env, JJ_CONFIG: config }
        const run = (...args: string[]) => {
            const process = Bun.spawnSync(args, { cwd: root, env, stdout: "pipe", stderr: "pipe" })
            if (!process.success) throw new Error(process.stderr.toString())
            return process.stdout.toString().trim()
        }
        // Use the same private config for service-owned children without changing global env.
        const processLayer = Layer.effect(
            AppProcess,
            AppProcess.use((process) =>
                Effect.succeed(
                    AppProcess.of({
                        run: (command) =>
                            process.run({ ...command, env: { ...command.env, JJ_CONFIG: config } }),
                        stream: (command) =>
                            process.stream({
                                ...command,
                                env: { ...command.env, JJ_CONFIG: config },
                            }),
                    }),
                ),
            ),
        ).pipe(Layer.provide(AppProcessLive))
        const client = makeApplicationClient(processLayer)
        try {
            run("jj", "git", "init", "--colocate")
            await writeFile(join(root, "file.txt"), "before\n")
            run("jj", "describe", "-m", "base")
            const a = await client.jjRefreshState({ cwd: root })
            await writeFile(join(root, "file.txt"), "after\n")
            expect(
                await client.jjFileContent("@", "file.txt", {
                    cwd: root,
                    atOperation: a.operationId,
                }),
            ).toBe("before\n")
            const b = await client.jjRefreshState({ cwd: root, previousState: a })
            expect(b.operationId).not.toBe(a.operationId)
            expect(b.workingCopyCommitId).not.toBe(a.workingCopyCommitId)
            expect(
                await client.jjFileContent("@", "file.txt", {
                    cwd: root,
                    atOperation: b.operationId,
                }),
            ).toBe("after\n")
            expect(
                await client.jjFileContent("@", "file.txt", {
                    cwd: root,
                    atOperation: a.operationId,
                }),
            ).toBe("before\n")
            run("git", "update-ref", "refs/heads/external-git", b.workingCopyCommitId)
            const c = await client.jjRefreshState({ cwd: root, previousState: b })
            expect(c.operationId).not.toBe(b.operationId)
            const bookmarks = await client.jjBookmarks({ cwd: root, atOperation: c.operationId })
            expect(bookmarks.some((bookmark) => bookmark.name === "external-git")).toBe(true)
            // Two mutations from the same operation create divergent operation heads.
            run(
                "jj",
                "--at-operation",
                c.operationId,
                "bookmark",
                "create",
                "concurrent-a",
                "-r",
                "@",
            )
            run(
                "jj",
                "--at-operation",
                c.operationId,
                "bookmark",
                "create",
                "concurrent-b",
                "-r",
                "@",
            )
            const reconciled = await client.jjRefreshState({ cwd: root, previousState: c })
            const merged = await client.jjBookmarks({
                cwd: root,
                atOperation: reconciled.operationId,
            })
            expect(merged.some((bookmark) => bookmark.name === "concurrent-a")).toBe(true)
            expect(merged.some((bookmark) => bookmark.name === "concurrent-b")).toBe(true)

            const linked = `${root}-linked`
            try {
                run("jj", "workspace", "add", linked, "-r", "@")
                run("jj", "-R", linked, "edit", reconciled.workingCopyCommitId)
                await writeFile(join(root, "file.txt"), "rewrite shared workspace tree\n")
                run("jj", "describe", "-m", "rewrite shared workspace commit")
                await expect(client.jjRefreshState({ cwd: linked })).rejects.toThrow("stale")
                expect((await client.jjWorkspaceUpdateStale({ cwd: linked })).success).toBe(true)
                const repaired = await client.jjRefreshState({ cwd: linked })
                expect(
                    await client.jjFileContent("@", "file.txt", {
                        cwd: linked,
                        atOperation: repaired.operationId,
                    }),
                ).toBe("rewrite shared workspace tree\n")
            } finally {
                await rm(linked, { recursive: true, force: true })
            }
        } finally {
            await client.dispose()
            await rm(root, { recursive: true, force: true })
        }
    })
})
