import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { makeApplicationClient } from "../../../src/application/client"
import type { Bookmark } from "../../../src/commander/bookmarks"
import type { CommandObserver } from "../../../src/commander/observer"
import { ConfigSchema } from "../../../src/config"
import { makeHooksLayer } from "../../../src/hooks/runner"
import { HookOperation } from "../../../src/hooks/types"
import {
    type ProcessResult,
    makeAppProcessFake,
} from "../../../src/process/app-process"
import { Stack } from "../../../src/stack/executor"
import type { StackPlan } from "../../../src/stack/model"

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

    test("inspects and initializes repositories through owned services", async () => {
        const commands: string[] = []
        const layer = makeAppProcessFake((command) => {
            const invocation = `${command.executable} ${command.args.join(" ")}`
            commands.push(invocation)
            if (invocation === "jj root") {
                return Effect.succeed({
                    ...success,
                    stdout: "/tmp/repository\n",
                    stderr: "",
                })
            }
            if (invocation === "git rev-parse --is-inside-work-tree") {
                return Effect.succeed({
                    ...success,
                    stdout: "true\n",
                    stderr: "",
                })
            }
            return Effect.succeed({ ...success, stdout: "", stderr: "" })
        })
        const client = makeApplicationClient(layer)

        await expect(
            client.repositoryStatus("/tmp/repository/child"),
        ).resolves.toEqual({
            isJjRepo: true,
            hasGitRepo: true,
            startupError: null,
            repoPath: "/tmp/repository",
        })
        await expect(
            client.initializeRepository("/tmp/new-repository", {
                colocate: true,
            }),
        ).resolves.toEqual({ success: true })
        await client.dispose()

        expect(commands).toEqual([
            "jj root",
            "git rev-parse --is-inside-work-tree",
            "jj status",
            "jj git init --colocate",
        ])
    })

    test("reports stale working copies during repository inspection", async () => {
        const layer = makeAppProcessFake((command) => {
            if (command.executable === "jj" && command.args[0] === "root") {
                return Effect.succeed({
                    ...success,
                    stdout: "/tmp/repository\n",
                    stderr: "",
                })
            }
            if (command.executable === "jj" && command.args[0] === "status") {
                return Effect.succeed({
                    ...success,
                    stdout: "",
                    stderr: "The working copy is stale",
                    exitCode: 1,
                })
            }
            return Effect.succeed({
                ...success,
                stdout: "true\n",
                stderr: "",
            })
        })
        const client = makeApplicationClient(layer)

        const status = await client.repositoryStatus("/tmp/repository")
        await client.dispose()

        expect(status.startupError).toBe("The working copy is stale")
    })

    test("routes GitHub reads and browser operations through the supplied process", async () => {
        const commands: string[] = []
        const layer = makeAppProcessFake((command) => {
            commands.push(`${command.executable} ${command.args.join(" ")}`)
            if (command.executable === "git") {
                return Effect.succeed({
                    ...success,
                    stdout: "git@github.com:eliaskc/kajji.git\n",
                    stderr: "",
                })
            }
            if (command.args[0] === "api") {
                return Effect.succeed({
                    ...success,
                    stdout: JSON.stringify({
                        data: {
                            repository: {
                                h0: {
                                    associatedPullRequests: {
                                        nodes: [
                                            {
                                                number: 42,
                                                headRefName: "feature",
                                                state: "OPEN",
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    }),
                    stderr: "",
                })
            }
            command.onOutput?.("stdout", "opened\n")
            return Effect.succeed({
                ...success,
                stdout: "opened\n",
                stderr: "",
            })
        })
        const client = makeApplicationClient(layer)

        const pulls = await client.ghListPullRequestsByHead(["feature"], {
            cwd: "/tmp/repository",
        })
        const opened = await client.ghPrCreateWeb("feature", {
            cwd: "/tmp/repository",
        })
        await client.dispose()

        expect(pulls.get("feature")?.number).toBe(42)
        expect(opened).toMatchObject({
            command: "gh pr create --web --head feature",
            success: true,
        })
        expect(
            commands.map((command) => command.split(" ").slice(0, 2)),
        ).toEqual([
            ["git", "remote"],
            ["gh", "api"],
            ["gh", "pr"],
        ])
    })

    test("routes stack preparation and apply through the supplied service", async () => {
        const calls: string[] = []
        const plan: StackPlan<Bookmark> = {
            kind: "sync",
            stackRootName: "feature-a",
            rows: [],
            effects: [],
            updatePrNumbers: [],
            createPrBookmarks: [],
            pushBookmarks: [],
            rebaseBookmarks: [],
            abandonBookmarks: [],
            closePrNumbers: [],
            applyCommand: "stack sync",
        }
        const stackLayer = Layer.succeed(
            Stack,
            Stack.of({
                persistedParent: (bookmark, cwd) => {
                    calls.push(`parent:${cwd}:${bookmark}`)
                    return Effect.succeed("main")
                },
                prepareSyncPlan: (options) => {
                    calls.push(
                        `prepare:${options.cwd}:${options.stackRootName}`,
                    )
                    return Effect.succeed(plan)
                },
                applyStackPlan: (input, options) => {
                    calls.push(`apply:${options.cwd}:${input.stackRootName}`)
                    return Effect.void
                },
            }),
        )
        const processLayer = makeAppProcessFake(() => Effect.succeed(success))
        const client = makeApplicationClient(
            processLayer,
            makeHooksLayer(() => ConfigSchema.parse({})),
            stackLayer,
        )

        await expect(
            client.stackParent("feature-a", { cwd: "/tmp/repository" }),
        ).resolves.toBe("main")
        await expect(
            client.prepareStackSync("feature-a", {
                cwd: "/tmp/repository",
            }),
        ).resolves.toBe(plan)
        await client.applyStackPlan(plan, { cwd: "/tmp/repository" })
        await client.dispose()

        expect(calls).toEqual([
            "parent:/tmp/repository:feature-a",
            "prepare:/tmp/repository:feature-a",
            "apply:/tmp/repository:feature-a",
        ])
    })

    test("routes the new family with explicit hook skipping", async () => {
        const commands: string[] = []
        const skipped: string[] = []
        const layer = makeAppProcessFake((command) => {
            commands.push(command.args.join(" "))
            return Effect.succeed(success)
        })
        const observer: CommandObserver = {
            start: () => "command",
            append: () => {},
            finish: () => {},
            skip: (message) => skipped.push(message),
        }
        const client = makeApplicationClient(layer)
        const options = {
            cwd: "/tmp/repository",
            verify: false,
            observer,
        }

        await client.jjNew("revision", options)
        await client.jjNewBefore("before", options)
        await client.jjNewAfter("after", options)
        await client.dispose()

        expect(commands).toEqual([
            "new revision",
            "new -B before",
            "new -A after",
        ])
        expect(skipped).toEqual([
            "pre-hooks for jj.new skipped (--no-verify)",
            "pre-hooks for jj.new skipped (--no-verify)",
            "pre-hooks for jj.new skipped (--no-verify)",
        ])
    })

    test("exposes hook availability without routing through Jj", async () => {
        const config = ConfigSchema.parse({
            gitHooksPath: false,
            repos: {
                "/tmp/repository": {
                    hooks: { "jj.new": { pre: ["check"] } },
                },
            },
        })
        const processLayer = makeAppProcessFake(() => Effect.succeed(success))
        const client = makeApplicationClient(
            processLayer,
            makeHooksLayer(() => config),
        )

        await expect(
            client.hasPreHooks(HookOperation.JjNew, {
                cwd: "/tmp/repository",
            }),
        ).resolves.toBe(true)
        await expect(
            client.hasPreHooks(HookOperation.JjNew, { cwd: "/tmp/other" }),
        ).resolves.toBe(false)
        await client.dispose()
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
        const restore = await client.jjOpRestore("op-id", {
            cwd: "/tmp/restore",
        })
        const repair = await client.jjWorkspaceUpdateStale({
            cwd: "/tmp/repair",
        })
        await client.dispose()

        expect(commands).toEqual([
            "/tmp/push:jj git push --bookmark main --dry-run",
            "/tmp/undo:jj undo",
            "/tmp/redo:jj redo",
            "/tmp/restore:jj op restore op-id",
            "/tmp/repair:jj workspace update-stale",
        ])
        expect([
            push.command,
            undo.command,
            redo.command,
            restore.command,
            repair.command,
        ]).toEqual([
            "jj git push --bookmark main --dry-run",
            "jj undo",
            "jj redo",
            "jj op restore op-id",
            "jj workspace update-stale",
        ])
    })

    test("routes revision and bookmark mutations", async () => {
        const commands: string[] = []
        const layer = makeAppProcessFake((command) => {
            commands.push(`jj ${command.args.join(" ")}`)
            return Effect.succeed(success)
        })
        const client = makeApplicationClient(layer)
        const options = { cwd: "/tmp/repository" }

        await client.jjEdit("edit", options)
        await client.jjDescribe("describe", "message", options)
        await client.jjSquash("squash", { ...options, into: "target" })
        await client.jjRebase("rebase", "target", options)
        await client.jjBookmarkCreate("create", {
            ...options,
            revision: "revision",
        })
        await client.jjBookmarkSet("set", "revision", options)
        await client.jjBookmarkDelete("delete", options)
        await client.jjBookmarkRename("old", "new", options)
        await client.jjBookmarkForget("forget", options)
        await client.jjDuplicate("duplicate", options)
        await client.jjAbandon("abandon", options)
        await client.jjRestore(["path"], {
            ...options,
            from: "parent",
            into: "revision",
        })
        await client.dispose()

        expect(commands).toEqual([
            "jj edit edit",
            "jj describe describe -m message",
            "jj squash --from squash --into target",
            "jj rebase -r rebase -d target",
            "jj bookmark create create -r revision",
            "jj bookmark set set -r revision",
            "jj bookmark delete delete",
            "jj bookmark rename old new",
            "jj bookmark forget forget",
            "jj duplicate duplicate",
            "jj abandon abandon",
            "jj restore --from parent --into revision path",
        ])
    })

    test("routes supporting reads without command observation", async () => {
        const layer = makeAppProcessFake((command) => {
            const args = command.args.join(" ")
            if (args.startsWith("op log"))
                return Effect.succeed({ ...success, stdout: "op\n" })
            if (args.includes("-T commit_id"))
                return Effect.succeed({ ...success, stdout: "commit\n" })
            if (args.includes("-T description"))
                return Effect.succeed({ ...success, stdout: "subject\nbody\n" })
            if (args.startsWith("bookmark list"))
                return Effect.succeed({ ...success, stdout: "bookmark\n" })
            return Effect.succeed({ ...success, stdout: "match\n" })
        })
        const client = makeApplicationClient(layer)
        const options = { cwd: "/tmp/repository" }

        expect(await client.jjIsInTrunk("revision", options)).toBe(true)
        expect(await client.jjShowDescription("revision", options)).toEqual({
            subject: "subject",
            body: "body",
        })
        expect(
            await client.jjNearestAncestorBookmarkNames("revision", options),
        ).toEqual(["bookmark"])
        expect(await client.jjRefreshState(options)).toEqual({
            operationId: "op",
            workingCopyCommitId: "commit",
        })
        await client.dispose()
    })

    test("routes captured file, detail, and operation log reads", async () => {
        const layer = makeAppProcessFake((command) => {
            const args = command.args.join(" ")
            if (args.includes("--summary")) {
                return Effect.succeed({ ...success, stdout: "M src/file.ts\n" })
            }
            if (args.startsWith("diff --git")) return Effect.succeed(success)
            if (args.startsWith("diff -r")) {
                return Effect.succeed({ ...success, stdout: "diff" })
            }
            if (args.startsWith("op log")) {
                return Effect.succeed({ ...success, stdout: "operation\n" })
            }
            if (args.startsWith("file show") && command.stdoutFile) {
                return Effect.promise(async () => {
                    await Bun.write(command.stdoutFile ?? "", "contents")
                    return success
                })
            }
            if (args === "root") {
                return Effect.succeed({ ...success, stdout: "/repo\n" })
            }
            if (args.startsWith("log -r cli-revisions")) {
                return Effect.succeed({
                    ...success,
                    stdout: "change\tcommit\tdescription\n",
                })
            }
            if (args.startsWith("file show")) {
                return Effect.succeed({ ...success, stdout: "contents\n" })
            }
            return Effect.succeed({
                ...success,
                stdout: "styled\n---KAJJI_DETAILS_SEPARATOR---\nsubject\nbody\n",
            })
        })
        const client = makeApplicationClient(layer)
        const options = { cwd: "/tmp/repository" }

        expect(await client.jjFiles({ revision: "revision" }, options)).toEqual(
            [{ path: "src/file.ts", status: "modified", isBinary: false }],
        )
        expect(await client.jjCommitDetails("revision", options)).toEqual({
            subject: "styled",
            body: "body",
        })
        expect(await client.jjOpLog(1, options)).toEqual(["operation", ""])
        expect(await client.jjRepositoryRoot(options)).toBe("/repo")
        expect(
            await client.jjRevisionSummaries("cli-revisions", options),
        ).toEqual([
            {
                changeId: "change",
                commitId: "commit",
                description: "description",
            },
        ])
        expect(
            await client.jjFileContent("revision", "src/file.ts", options),
        ).toBe("contents\n")
        const materialized = await client.jjMaterializeFiles(
            "revision",
            ["src/file.bin"],
            options,
        )
        expect(await Bun.file(materialized[0] ?? "").text()).toBe("contents")
        expect(
            await client.jjDiff(
                { revision: "revision" },
                { ...options, color: true },
            ),
        ).toBe("diff")
        expect(await client.jjBookmarks(options)).toEqual([])
        expect(await client.jjLogPage({ ...options, limit: 1 })).toEqual({
            commits: [],
            hasMore: false,
        })
        await client.dispose()
    })

    test("preserves normal non-zero exits at the compatibility edge", async () => {
        const layer = makeAppProcessFake(() =>
            Effect.succeed({ ...success, exitCode: 1, stderr: "failed" }),
        )
        const client = makeApplicationClient(layer)

        const result = await client.jjGitFetch({ cwd: "/tmp/repository" })
        await expect(
            client.jjDiff({ revision: "revision" }, { cwd: "/tmp/repository" }),
        ).rejects.toThrow("jj diff failed: failed")
        await client.dispose()

        expect(result).toMatchObject({
            exitCode: 1,
            success: false,
            stderr: "failed",
        })
    })

    test("cancels scoped streaming reads", async () => {
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
        const client = makeApplicationClient(layer)
        const stream = client.jjStreamLogPage(
            { cwd: "/tmp/repository", limit: 50 },
            () => {},
        )

        await startedPromise
        stream.cancel()

        await expect(stream.result).rejects.toBeDefined()
        expect(released).toBe(true)
        await client.dispose()
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
        await expect(
            client.jjMaterializeFiles("revision", ["file"], {
                cwd: "/tmp/repository",
            }),
        ).rejects.toThrow("shutting down")
    })
})
