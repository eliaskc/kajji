import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { makeApplicationClient } from "../../../src/application/client"
import type { Bookmark } from "../../../src/commander/bookmarks"
import { Jj, type JjOperationResult, type JjService } from "../../../src/commander/jj"
import type { CommandObserver } from "../../../src/commander/observer"
import { ConfigSchema } from "../../../src/config"
import { makeHooksLayer } from "../../../src/hooks/runner"
import { HookOperation } from "../../../src/hooks/types"
import type { ProcessResult } from "../../../src/process/app-process"
import { Stack } from "../../../src/stack/executor"
import type { StackPlan } from "../../../src/stack/model"
import { JjLive, makeAppProcessFake, makeInteractiveProcessFake } from "../../support/layers"

const success: ProcessResult = {
    stdout: "fetched\n",
    stderr: "warning\n",
    exitCode: 0,
    durationMs: 10,
}

interface Invocation {
    readonly cwd: string
    readonly args: readonly string[]
}

function recordingProcess() {
    const invocations: Invocation[] = []
    const layer = makeAppProcessFake((command) => {
        invocations.push({ cwd: command.cwd, args: command.args })
        return Effect.succeed(success)
    })
    return { layer, invocations }
}

/**
 * Runs operations directly through Jj. `commander/jj.test.ts` owns the argv
 * contract; client tests compare against this to prove routing only.
 */
async function directJj(
    operations: ReadonlyArray<(jj: JjService) => Effect.Effect<JjOperationResult, unknown>>,
) {
    const { layer, invocations } = recordingProcess()
    const results = await Effect.runPromise(
        Effect.forEach(operations, (operation) => Jj.use(operation)).pipe(
            Effect.provide(JjLive),
            Effect.provide(layer),
        ),
    )
    return { invocations, commands: results.map((result) => result.command) }
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
        expect(events).toEqual(["start:jj git fetch", "append:fetched", "append:warning", "finish"])
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
            return Effect.succeed({ ...success, stdout: "snapshot-id", stderr: "" })
        })
        const client = makeApplicationClient(layer)

        await expect(client.repositoryStatus("/tmp/repository/child")).resolves.toEqual({
            isJjRepo: true,
            hasGitRepo: true,
            brokenMetadata: null,
            startupError: null,
            repoPath: "/tmp/repository",
            refreshState: { operationId: "snapshot-id", workingCopyCommitId: "snapshot-id" },
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
            "jj op log --limit 1 --no-graph --color never -T self.id()",
            "jj log --limit 1 --no-graph -r @ -T commit_id --at-operation snapshot-id",
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
            if (command.executable === "jj" && command.args[0] === "op") {
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
        expect(commands.map((command) => command.split(" ").slice(0, 2))).toEqual([
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
                    calls.push(`prepare:${options.cwd}:${options.stackRootName}`)
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

        await expect(client.stackParent("feature-a", { cwd: "/tmp/repository" })).resolves.toBe(
            "main",
        )
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
        const { layer, invocations } = recordingProcess()
        const skipped: string[] = []
        const observer: CommandObserver = {
            start: () => "command",
            append: () => {},
            finish: () => {},
            skip: (message) => skipped.push(message),
        }
        const client = makeApplicationClient(layer)
        const options = { cwd: "/tmp/repository", verify: false }

        await client.jjNew("revision", { ...options, observer })
        await client.jjNewBefore("before", { ...options, observer })
        await client.jjNewAfter("after", { ...options, observer })
        await client.dispose()

        const direct = await directJj([
            (jj) => jj.new("revision", options),
            (jj) => jj.new("before", { ...options, position: "before" }),
            (jj) => jj.new("after", { ...options, position: "after" }),
        ])
        expect(invocations).toEqual(direct.invocations)
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
        await expect(client.hasPreHooks(HookOperation.JjNew, { cwd: "/tmp/other" })).resolves.toBe(
            false,
        )
        await client.dispose()
    })

    test("routes push, undo, and redo through the supplied process", async () => {
        const { layer, invocations } = recordingProcess()
        const client = makeApplicationClient(layer)

        const results = [
            await client.jjGitPush({ cwd: "/tmp/push", bookmarks: ["main"], dryRun: true }),
            await client.jjUndo({ cwd: "/tmp/undo" }),
            await client.jjRedo({ cwd: "/tmp/redo" }),
            await client.jjOpRestore("op-id", { cwd: "/tmp/restore" }),
            await client.jjWorkspaceUpdateStale({ cwd: "/tmp/repair" }),
        ]
        await client.dispose()

        const direct = await directJj([
            (jj) => jj.gitPush({ cwd: "/tmp/push", bookmarks: ["main"], dryRun: true }),
            (jj) => jj.undo({ cwd: "/tmp/undo" }),
            (jj) => jj.redo({ cwd: "/tmp/redo" }),
            (jj) => jj.opRestore("op-id", { cwd: "/tmp/restore" }),
            (jj) => jj.workspaceUpdateStale({ cwd: "/tmp/repair" }),
        ])
        expect(invocations).toEqual(direct.invocations)
        expect(results.map((result) => result.command)).toEqual(direct.commands)
        expect(results.every((result) => result.success)).toBe(true)
    })

    test("routes revision and bookmark mutations", async () => {
        const { layer, invocations } = recordingProcess()
        const client = makeApplicationClient(layer)
        const options = { cwd: "/tmp/repository" }

        await client.jjEdit("edit", options)
        await client.jjDescribe("describe", "message", options)
        await client.jjSquash("squash", { ...options, into: "target" })
        await client.jjRebase("rebase", "target", options)
        await client.jjBookmarkCreate("create", { ...options, revision: "revision" })
        await client.jjBookmarkSet("set", "revision", options)
        await client.jjBookmarkDelete("delete", options)
        await client.jjBookmarkRename("old", "new", options)
        await client.jjBookmarkForget("forget", options)
        await client.jjDuplicate("duplicate", options)
        await client.jjAbandon("abandon", options)
        await client.jjRestore(["path"], { ...options, from: "parent", into: "revision" })
        await client.dispose()

        const direct = await directJj([
            (jj) => jj.edit("edit", options),
            (jj) => jj.describe("describe", "message", options),
            (jj) => jj.squash("squash", { ...options, into: "target" }),
            (jj) => jj.rebase("rebase", "target", options),
            (jj) => jj.bookmarkCreate("create", { ...options, revision: "revision" }),
            (jj) => jj.bookmarkSet("set", "revision", options),
            (jj) => jj.bookmarkDelete("delete", options),
            (jj) => jj.bookmarkRename("old", "new", options),
            (jj) => jj.bookmarkForget("forget", options),
            (jj) => jj.duplicate("duplicate", options),
            (jj) => jj.abandon("abandon", options),
            (jj) => jj.restore(["path"], { ...options, from: "parent", into: "revision" }),
        ])
        expect(invocations).toEqual(direct.invocations)
    })

    test("routes interactive jj commands and preserves exit behavior", async () => {
        const commands: string[] = []
        let exitCode = 0
        const interactiveLayer = makeInteractiveProcessFake((command) => {
            commands.push(`${command.cwd}:${command.executable} ${command.args.join(" ")}`)
            return Effect.succeed({ exitCode, durationMs: 10 })
        })
        const client = makeApplicationClient(
            makeAppProcessFake(() => Effect.succeed(success)),
            undefined,
            undefined,
            undefined,
            interactiveLayer,
        )

        await expect(
            client.jjSplitInteractive("split", {
                cwd: "/tmp/split",
                ignoreImmutable: true,
            }),
        ).resolves.toEqual({ success: true })
        await expect(
            client.jjResolveInteractive({
                cwd: "/tmp/resolve",
                revision: "resolve",
                paths: ["path"],
            }),
        ).resolves.toEqual({ success: true })
        exitCode = 2
        await expect(
            client.jjSquashInteractive("squash", {
                cwd: "/tmp/squash",
                into: "target",
            }),
        ).resolves.toEqual({
            success: false,
            error: "jj squash -i exited with code 2",
        })
        await client.dispose()

        expect(commands).toEqual([
            "/tmp/split:jj split -r split --ignore-immutable",
            "/tmp/resolve:jj resolve -r resolve path",
            "/tmp/squash:jj squash -i --from squash --into target",
        ])
    })

    test("routes supporting reads without command observation", async () => {
        const layer = makeAppProcessFake((command) => {
            const args = command.args.join(" ")
            if (args.startsWith("op log")) return Effect.succeed({ ...success, stdout: "op\n" })
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
        expect(await client.jjNearestAncestorBookmarkNames("revision", options)).toEqual([
            "bookmark",
        ])
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

        expect(await client.jjFiles({ revision: "revision" }, options)).toEqual([
            { path: "src/file.ts", status: "modified", isBinary: false },
        ])
        expect(await client.jjCommitDetails("revision", options)).toEqual({
            subject: "styled",
            body: "body",
        })
        expect(await client.jjOpLog(1, options)).toEqual(["operation", ""])
        expect(await client.jjRepositoryRoot(options)).toBe("/repo")
        expect(await client.jjRevisionSummaries("cli-revisions", options)).toEqual([
            {
                changeId: "change",
                commitId: "commit",
                description: "description",
            },
        ])
        expect(await client.jjFileContent("revision", "src/file.ts", options)).toBe("contents\n")
        const materialized = await client.jjMaterializeFiles("revision", ["src/file.bin"], options)
        expect(await Bun.file(materialized[0] ?? "").text()).toBe("contents")
        expect(await client.jjDiff({ revision: "revision" }, { ...options, color: true })).toBe(
            "diff",
        )
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

    test("propagates streaming consumer failures", async () => {
        const output =
            "@  __LJ__one__LJ__commit-one__LJ____LJ__false__LJ__false__LJ__false__LJ__false__LJ__false__LJ__one__LJ__A__LJ__a@example.com__LJ__2025-01-01 12:00:00__LJ__2025-01-01 12:00:00__LJ____LJ____LJ__one\n" +
            "○  __LJ__two__LJ__commit-two__LJ____LJ__false__LJ__false__LJ__false__LJ__false__LJ__false__LJ__two__LJ__A__LJ__a@example.com__LJ__2025-01-01 11:00:00__LJ__2025-01-01 11:00:00__LJ____LJ____LJ__two\n"
        const layer = makeAppProcessFake(
            () => Effect.succeed({ ...success, stdout: output }),
            () =>
                Stream.fromIterable([
                    {
                        _tag: "Output" as const,
                        stream: "stdout" as const,
                        chunk: output,
                    },
                    {
                        _tag: "Complete" as const,
                        result: { ...success, stdout: output },
                    },
                ]),
        )
        const client = makeApplicationClient(layer)
        const stream = client.jjStreamLogPage({ cwd: "/tmp/repository", limit: 50 }, () => {
            throw new Error("consumer failed")
        })

        await expect(stream.result).rejects.toThrow("consumer failed")
        await client.dispose()
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
        const stream = client.jjStreamLogPage({ cwd: "/tmp/repository", limit: 50 }, () => {})

        await startedPromise
        stream.cancel()

        await expect(stream.result).rejects.toThrow("interrupted")
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

        await expect(operation).rejects.toThrow("interrupted")
        expect(released).toBe(true)
        expect(completions).toBe(1)
        await expect(client.jjGitFetch({ cwd: "/tmp/repository" })).rejects.toThrow("shutting down")
        await expect(
            client.jjMaterializeFiles("revision", ["file"], {
                cwd: "/tmp/repository",
            }),
        ).rejects.toThrow("shutting down")
    })
})
