import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import {
    Jj,
    JjCommandError,
    type JjGitFetchOptions,
    JjLayer,
    JjLive,
    JjReadError,
    JjStaleWorkingCopyError,
    type OperationSink,
} from "../../../src/commander/jj"
import { ConfigSchema } from "../../../src/config"
import { makeHooksLayer } from "../../../src/hooks/runner"
import {
    type ProcessCommand,
    type ProcessResult,
    ProcessSpawnError,
    makeAppProcessFake,
} from "../../../src/process/app-process"

function runWithResult(result: ProcessResult, options: JjGitFetchOptions) {
    let command: ProcessCommand | undefined
    const processLayer = makeAppProcessFake((input) => {
        command = input
        input.onOutput?.("stdout", result.stdout)
        input.onOutput?.("stderr", result.stderr)
        return Effect.succeed(result)
    })
    const effect = Jj.use((jj) => jj.gitFetch(options)).pipe(
        Effect.provide(JjLive),
        Effect.provide(processLayer),
    )
    return { effect, command: () => command }
}

const success: ProcessResult = {
    stdout: "fetched\n",
    stderr: "warning\n",
    exitCode: 0,
    durationMs: 12,
}

describe("Jj", () => {
    test("constructs all fetch options and preserves explicit cwd", async () => {
        const invocation = runWithResult(success, {
            cwd: "/tmp/repository",
            branches: ["main", "glob:push-*"],
            tracked: true,
            remotes: ["origin", "upstream"],
            allRemotes: true,
        })

        const result = await Effect.runPromise(invocation.effect)

        expect(invocation.command()).toMatchObject({
            executable: "jj",
            cwd: "/tmp/repository",
            args: [
                "git",
                "fetch",
                "--branch",
                "main",
                "--branch",
                "glob:push-*",
                "--tracked",
                "--remote",
                "origin",
                "--remote",
                "upstream",
                "--all-remotes",
            ],
            env: { JJ_EDITOR: "true", EDITOR: "true", VISUAL: "true" },
        })
        expect(result).toEqual({ ...success, command: expect.any(String) })
        expect(result.command).toBe(
            "jj git fetch --branch main --branch glob:push-* --tracked --remote origin --remote upstream --all-remotes",
        )
    })

    test("constructs all push options", async () => {
        let command: ProcessCommand | undefined
        const processLayer = makeAppProcessFake((input) => {
            command = input
            return Effect.succeed(success)
        })
        const effect = Jj.use((jj) =>
            jj.gitPush({
                cwd: "/tmp/repository",
                remote: "origin",
                bookmarks: ["main", "next"],
                all: true,
                tracked: true,
                deleted: true,
                allowEmptyDescription: true,
                allowPrivate: true,
                revisions: ["abc", "def"],
                changes: ["change-1", "change-2"],
                dryRun: true,
            }),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        const result = await Effect.runPromise(effect)

        expect(command).toMatchObject({
            executable: "jj",
            cwd: "/tmp/repository",
            args: [
                "git",
                "push",
                "--remote",
                "origin",
                "--bookmark",
                "main",
                "--bookmark",
                "next",
                "--all",
                "--tracked",
                "--deleted",
                "--allow-empty-description",
                "--allow-private",
                "--revisions",
                "abc",
                "--revisions",
                "def",
                "--change",
                "change-1",
                "--change",
                "change-2",
                "--dry-run",
            ],
        })
        expect(result.command).toBe(
            "jj git push --remote origin --bookmark main --bookmark next --all --tracked --deleted --allow-empty-description --allow-private --revisions abc --revisions def --change change-1 --change change-2 --dry-run",
        )
    })

    test("constructs undo and redo with explicit repository paths", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed(success)
        })
        const effect = Effect.all(
            [
                Jj.use((jj) => jj.undo({ cwd: "/tmp/undo-repository" })),
                Jj.use((jj) => jj.redo({ cwd: "/tmp/redo-repository" })),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        const results = await Effect.runPromise(effect)

        expect(commands.map(({ args, cwd }) => ({ args, cwd }))).toEqual([
            { args: ["undo"], cwd: "/tmp/undo-repository" },
            { args: ["redo"], cwd: "/tmp/redo-repository" },
        ])
        expect(results.map((result) => result.command)).toEqual([
            "jj undo",
            "jj redo",
        ])
    })

    test("constructs op restore and workspace repair commands", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed(success)
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.opRestore("operation-id", { cwd: "/tmp/op-repository" }),
                ),
                Jj.use((jj) =>
                    jj.workspaceUpdateStale({ cwd: "/tmp/stale-repository" }),
                ),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        const results = await Effect.runPromise(effect)

        expect(commands.map(({ args, cwd }) => ({ args, cwd }))).toEqual([
            {
                args: ["op", "restore", "operation-id"],
                cwd: "/tmp/op-repository",
            },
            {
                args: ["workspace", "update-stale"],
                cwd: "/tmp/stale-repository",
            },
        ])
        expect(results.map((result) => result.command)).toEqual([
            "jj op restore operation-id",
            "jj workspace update-stale",
        ])
    })

    test("constructs edit, describe, squash, and rebase commands", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed(success)
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.edit("edit-rev", {
                        cwd: "/tmp/repository",
                        ignoreImmutable: true,
                    }),
                ),
                Jj.use((jj) =>
                    jj.describe("describe-rev", "secret message", {
                        cwd: "/tmp/repository",
                        ignoreImmutable: true,
                    }),
                ),
                Jj.use((jj) =>
                    jj.squash("squash-rev", {
                        cwd: "/tmp/repository",
                        into: "target-rev",
                        useDestinationMessage: true,
                        keepEmptied: true,
                        ignoreImmutable: true,
                    }),
                ),
                Jj.use((jj) =>
                    jj.rebase("rebase-rev", "destination-rev", {
                        cwd: "/tmp/repository",
                        mode: "descendants",
                        targetMode: "insertBefore",
                        skipEmptied: true,
                        ignoreImmutable: true,
                    }),
                ),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        const results = await Effect.runPromise(effect)

        expect(commands.map((command) => command.args)).toEqual([
            ["edit", "edit-rev", "--ignore-immutable"],
            [
                "describe",
                "describe-rev",
                "-m",
                "secret message",
                "--ignore-immutable",
            ],
            [
                "squash",
                "--from",
                "squash-rev",
                "--into",
                "target-rev",
                "-u",
                "-k",
                "--ignore-immutable",
            ],
            [
                "rebase",
                "-s",
                "rebase-rev",
                "-B",
                "destination-rev",
                "--skip-emptied",
                "--ignore-immutable",
            ],
        ])
        expect(results.map((result) => result.command)).toEqual([
            "jj edit edit-rev --ignore-immutable",
            'jj describe describe-rev -m "..."',
            "jj squash --from squash-rev --into target-rev -u -k --ignore-immutable",
            "jj rebase -s rebase-rev -B destination-rev --skip-emptied --ignore-immutable",
        ])
    })

    test("constructs bookmark mutation commands", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed(success)
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.bookmarkCreate("new", {
                        cwd: "/tmp/repository",
                        revision: "revision",
                    }),
                ),
                Jj.use((jj) =>
                    jj.bookmarkSet("move", "revision", {
                        cwd: "/tmp/repository",
                        allowBackwards: true,
                    }),
                ),
                Jj.use((jj) =>
                    jj.bookmarkDelete("delete", { cwd: "/tmp/repository" }),
                ),
                Jj.use((jj) =>
                    jj.bookmarkRename("old", "new", {
                        cwd: "/tmp/repository",
                    }),
                ),
                Jj.use((jj) =>
                    jj.bookmarkForget("forget", { cwd: "/tmp/repository" }),
                ),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await Effect.runPromise(effect)

        expect(commands.map((command) => command.args)).toEqual([
            ["bookmark", "create", "new", "-r", "revision"],
            ["bookmark", "set", "move", "-r", "revision", "--allow-backwards"],
            ["bookmark", "delete", "delete"],
            ["bookmark", "rename", "old", "new"],
            ["bookmark", "forget", "forget"],
        ])
    })

    test("constructs new placement commands when hooks are skipped", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed(success)
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.new("revision", {
                        cwd: "/tmp/repository",
                        verify: false,
                    }),
                ),
                Jj.use((jj) =>
                    jj.new("before", {
                        cwd: "/tmp/repository",
                        position: "before",
                        verify: false,
                    }),
                ),
                Jj.use((jj) =>
                    jj.new("after", {
                        cwd: "/tmp/repository",
                        position: "after",
                        verify: false,
                    }),
                ),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await Effect.runPromise(effect)

        expect(commands.map((command) => command.args)).toEqual([
            ["new", "revision"],
            ["new", "-B", "before"],
            ["new", "-A", "after"],
        ])
    })

    test("returns the failed hook result without running jj new", async () => {
        const commands: ProcessCommand[] = []
        const hookFailure = {
            ...success,
            stdout: "",
            stderr: "hook failed",
            exitCode: 7,
        }
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed(hookFailure)
        })
        const config = ConfigSchema.parse({
            gitHooksPath: false,
            repos: {
                "/tmp/repository": {
                    hooks: { "jj.new": { pre: ["check"] } },
                },
            },
        })
        const effect = Jj.use((jj) =>
            jj.new("revision", { cwd: "/tmp/repository" }),
        ).pipe(
            Effect.provide(JjLayer),
            Effect.provide(makeHooksLayer(() => config)),
            Effect.provide(processLayer),
        )

        const result = await Effect.runPromise(effect)

        expect(commands.map((command) => command.executable)).toEqual(["sh"])
        expect(result).toEqual({
            ...hookFailure,
            command: "hook jj.new: check",
        })
    })

    test("constructs duplicate, abandon, and restore commands", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed(success)
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.duplicate("duplicate", { cwd: "/tmp/repository" }),
                ),
                Jj.use((jj) =>
                    jj.abandon("abandon", {
                        cwd: "/tmp/repository",
                        ignoreImmutable: true,
                    }),
                ),
                Jj.use((jj) =>
                    jj.restore(["one", "two"], {
                        cwd: "/tmp/repository",
                        from: "parent",
                        into: "revision",
                    }),
                ),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await Effect.runPromise(effect)

        expect(commands.map((command) => command.args)).toEqual([
            ["duplicate", "duplicate"],
            ["abandon", "abandon", "--ignore-immutable"],
            ["restore", "--from", "parent", "--into", "revision", "one", "two"],
        ])
    })

    test("constructs historical file materialization", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed(success)
        })
        const effect = Jj.use((jj) =>
            jj.materializeFile("revision", "src/file.bin", "/tmp/output.bin", {
                cwd: "/tmp/repository",
            }),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await Effect.runPromise(effect)

        expect(commands[0]?.args).toEqual([
            "file",
            "show",
            "-r",
            "revision",
            "src/file.bin",
        ])
        expect(commands[0]?.stdoutFile).toBe("/tmp/output.bin")
    })

    test("constructs and parses standalone CLI reads", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            if (command.args[0] === "root") {
                return Effect.succeed({ ...success, stdout: "/repo\n" })
            }
            if (command.args[0] === "file") {
                return Effect.succeed({ ...success, stdout: "contents\n" })
            }
            return Effect.succeed({
                ...success,
                stdout: "change\tcommit\tdescription\n",
            })
        })
        const effect = Jj.use((jj) =>
            Effect.all(
                [
                    jj.repositoryRoot({ cwd: "/tmp/repository" }),
                    jj.revisionSummaries("mine()", {
                        cwd: "/tmp/repository",
                    }),
                    jj.fileContent("commit", "src/file.ts", {
                        cwd: "/tmp/repository",
                    }),
                ],
                { concurrency: 1 },
            ),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        const [root, revisions, content] = await Effect.runPromise(effect)

        expect(root).toBe("/repo")
        expect(revisions).toEqual([
            {
                changeId: "change",
                commitId: "commit",
                description: "description",
            },
        ])
        expect(content).toBe("contents\n")
        expect(commands.map((command) => command.args.slice(0, 4))).toEqual([
            ["root"],
            ["log", "-r", "mine()", "--no-graph"],
            ["file", "show", "-r", "commit"],
        ])
    })

    test("preserves standalone CLI read failures", async () => {
        const processLayer = makeAppProcessFake((command) => {
            if (command.args[0] === "root") {
                return Effect.succeed({
                    ...success,
                    exitCode: 1,
                    stderr: "not a repository\n",
                })
            }
            return Effect.succeed({ ...success, exitCode: 1 })
        })
        const provide = <A, E>(effect: Effect.Effect<A, E, Jj>) =>
            effect.pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await expect(
            Effect.runPromise(
                provide(
                    Jj.use((jj) =>
                        jj.repositoryRoot({ cwd: "/tmp/repository" }),
                    ),
                ),
            ),
        ).rejects.toThrow("not a repository")
        await expect(
            Effect.runPromise(
                provide(
                    Jj.use((jj) =>
                        jj.revisionSummaries("bad", {
                            cwd: "/tmp/repository",
                        }),
                    ),
                ),
            ),
        ).rejects.toThrow("jj log failed")
    })

    test("interprets supporting read results", async () => {
        const processLayer = makeAppProcessFake((command) => {
            const args = command.args.join(" ")
            if (args.startsWith("op log")) {
                return Effect.succeed({ ...success, stdout: "operation-id\n" })
            }
            if (args.includes("-T commit_id")) {
                return Effect.succeed({
                    ...success,
                    stdout: "\u001b[31mcommit-id\u001b[0m\n",
                })
            }
            if (args.includes("-T description")) {
                return Effect.succeed({
                    ...success,
                    stdout: "subject\n\nbody\n",
                })
            }
            if (args.startsWith("bookmark list")) {
                return Effect.succeed({ ...success, stdout: "one\ntwo\n" })
            }
            return Effect.succeed({ ...success, stdout: "match\n" })
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.isInTrunk("revision", { cwd: "/tmp/repository" }),
                ),
                Jj.use((jj) =>
                    jj.showDescription("revision", {
                        cwd: "/tmp/repository",
                    }),
                ),
                Jj.use((jj) =>
                    jj.nearestAncestorBookmarkNames("revision", {
                        cwd: "/tmp/repository",
                    }),
                ),
                Jj.use((jj) => jj.operationId({ cwd: "/tmp/repository" })),
                Jj.use((jj) =>
                    jj.revsetHasMatches("mine()", {
                        cwd: "/tmp/repository",
                    }),
                ),
                Jj.use((jj) => jj.refreshState({ cwd: "/tmp/repository" })),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        const [
            inTrunk,
            description,
            bookmarks,
            operationId,
            hasMatches,
            refreshState,
        ] = await Effect.runPromise(effect)

        expect(inTrunk).toBe(true)
        expect(description).toEqual({ subject: "subject", body: "body" })
        expect(bookmarks).toEqual(["one", "two"])
        expect(operationId).toBe("operation-id")
        expect(hasMatches).toBe(true)
        expect(refreshState).toEqual({
            operationId: "operation-id",
            workingCopyCommitId: "commit-id",
        })
    })

    test("reads revision files and binary status", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            if (command.args.includes("--summary")) {
                return Effect.succeed({
                    ...success,
                    stdout: "M src/text.ts\nA image.png\n",
                })
            }
            return Effect.succeed({
                ...success,
                stdout: "diff --git a/image.png b/image.png\nBinary files differ\n",
            })
        })
        const effect = Jj.use((jj) =>
            jj.files({ revision: "revision" }, { cwd: "/tmp/repository" }),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await expect(Effect.runPromise(effect)).resolves.toEqual([
            { path: "src/text.ts", status: "modified", isBinary: false },
            { path: "image.png", status: "added", isBinary: true },
        ])
        expect(commands.map((command) => command.args)).toEqual([
            ["diff", "--summary", "-r", "revision"],
            ["diff", "--git", "-r", "revision"],
        ])
    })

    test("reads colored and parsed diff forms", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed({ ...success, stdout: "diff output" })
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.diff(
                        { revision: "revision" },
                        {
                            cwd: "/tmp/repository",
                            color: true,
                            columns: 120,
                            paths: ["src/file.ts"],
                        },
                    ),
                ),
                Jj.use((jj) =>
                    jj.diff(
                        { from: "from", to: "to" },
                        { cwd: "/tmp/repository" },
                    ),
                ),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await expect(Effect.runPromise(effect)).resolves.toEqual([
            "diff output",
            "diff output",
        ])
        expect(commands[0]).toMatchObject({
            args: [
                "diff",
                "-r",
                "revision",
                "--color",
                "always",
                'file:"src/file.ts"',
            ],
            env: expect.objectContaining({ COLUMNS: "120" }),
        })
        expect(commands[1]?.args).toEqual([
            "diff",
            "--from",
            "from",
            "--to",
            "to",
            "--git",
        ])
    })

    test("constructs captured bookmark and paged log reads", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            return Effect.succeed({ ...success, stdout: "" })
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.bookmarks({
                        cwd: "/tmp/repository",
                        allRemotes: true,
                    }),
                ),
                Jj.use((jj) =>
                    jj.logPage({
                        cwd: "/tmp/repository",
                        revset: "mine()",
                        limit: 20,
                    }),
                ),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await expect(Effect.runPromise(effect)).resolves.toEqual([
            [],
            { commits: [], hasMore: false },
        ])
        expect(commands[0]?.args.slice(0, 6)).toEqual([
            "--color",
            "always",
            "bookmark",
            "list",
            "--sort",
            "committer-date-",
        ])
        expect(commands[0]?.args.at(-1)).toBe("--all-remotes")
        expect(commands[1]?.args).toContain("mine()")
        expect(commands[1]?.args.slice(-2)).toEqual(["--limit", "21"])
    })

    test("incrementally parses bookmark output", async () => {
        const lines = [
            "__BJ__main__BJ__main__BJ____BJ__change-one__BJ__commit-one__BJ__one__BJ__commit-one__BJ__first",
            "__BJ__feature__BJ__feature__BJ____BJ__change-two__BJ__commit-two__BJ__two__BJ__commit-two__BJ__second",
        ]
        const output = `${lines.join("\n")}\n`
        const firstLineEnd = output.indexOf("\n") + 1
        const chunks = [
            output.slice(0, 24),
            output.slice(24, firstLineEnd),
            output.slice(firstLineEnd),
        ]
        const processLayer = makeAppProcessFake((command) =>
            Effect.promise(async () => {
                for (const chunk of chunks) {
                    await command.onOutput?.("stdout", chunk)
                }
                return { ...success, stdout: output }
            }),
        )
        const batches: string[][] = []
        const effect = Jj.use((jj) =>
            jj.streamBookmarks({ cwd: "/tmp/repository" }, (bookmarks) => {
                batches.push(bookmarks.map((bookmark) => bookmark.name))
            }),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await expect(Effect.runPromise(effect)).resolves.toMatchObject([
            { name: "main" },
            { name: "feature" },
        ])
        expect(batches).toEqual([["main"], ["main", "feature"]])
    })

    test("incrementally parses log output with backpressured batches", async () => {
        const lines = [
            "@  __LJ__one__LJ__commit-one__LJ__false__LJ__false__LJ__false__LJ__false__LJ__one__LJ__A__LJ__a@example.com__LJ__2025-01-01 12:00:00__LJ____LJ__false__LJ____LJ__one",
            "○  __LJ__two__LJ__commit-two__LJ__false__LJ__false__LJ__false__LJ__false__LJ__two__LJ__A__LJ__a@example.com__LJ__2025-01-01 11:00:00__LJ____LJ__false__LJ____LJ__two",
            "◆  __LJ__three__LJ__commit-three__LJ__true__LJ__true__LJ__false__LJ__false__LJ__three__LJ__A__LJ__a@example.com__LJ__2025-01-01 10:00:00__LJ____LJ__false__LJ____LJ__three",
        ]
        const processLayer = makeAppProcessFake((command) =>
            Effect.promise(async () => {
                for (const line of lines) {
                    await command.onOutput?.("stdout", `${line}\n`)
                }
                return { ...success, stdout: `${lines.join("\n")}\n` }
            }),
        )
        const batches: string[][] = []
        const effect = Jj.use((jj) =>
            jj.streamLogPage(
                { cwd: "/tmp/repository", limit: 2 },
                async (commits) => {
                    batches.push(commits.map((commit) => commit.changeId))
                    await Bun.sleep(1)
                },
            ),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await expect(Effect.runPromise(effect)).resolves.toMatchObject({
            commits: [{ changeId: "one" }, { changeId: "two" }],
            hasMore: true,
        })
        expect(batches[0]).toEqual(["one"])
    })

    test("reads commit details and bounded operation log", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            if (command.args[0] === "op") {
                return Effect.succeed({ ...success, stdout: "one\ntwo\n" })
            }
            return Effect.succeed({
                ...success,
                stdout: "styled subject\n---KAJJI_DETAILS_SEPARATOR---\nsubject\nbody\n",
            })
        })
        const effect = Effect.all(
            [
                Jj.use((jj) =>
                    jj.commitDetails("revision", { cwd: "/tmp/repository" }),
                ),
                Jj.use((jj) => jj.opLog(2, { cwd: "/tmp/repository" })),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await expect(Effect.runPromise(effect)).resolves.toEqual([
            { subject: "styled subject", body: "body" },
            ["one", "two", ""],
        ])
        expect(commands[1]?.args).toEqual([
            "op",
            "log",
            "--color",
            "always",
            "--ignore-working-copy",
            "--limit",
            "2",
        ])
    })

    test("reports normal read failures with capability context", async () => {
        const processLayer = makeAppProcessFake(() =>
            Effect.succeed({ ...success, exitCode: 1, stderr: "bad revision" }),
        )
        const effect = Jj.use((jj) =>
            jj.diff({ revision: "revision" }, { cwd: "/tmp/repository" }),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        const failure = await Effect.runPromise(Effect.flip(effect))
        expect(failure).toBeInstanceOf(JjReadError)
        expect(failure).toMatchObject({ kind: "diff" })
        expect(failure.message).toBe("jj diff failed: bad revision")
    })

    test("preflights refreshes for a stale working copy", async () => {
        const commands: ProcessCommand[] = []
        const processLayer = makeAppProcessFake((command) => {
            commands.push(command)
            if (command.args[0] === "status") {
                return Effect.succeed({
                    ...success,
                    exitCode: 1,
                    stderr: "Could not read working copy's operation",
                })
            }
            return Effect.succeed(success)
        })
        const effect = Jj.use((jj) =>
            jj.refreshState({ cwd: "/tmp/repository" }),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer))

        await expect(Effect.runPromise(effect)).rejects.toBeInstanceOf(
            JjStaleWorkingCopyError,
        )
        expect(commands.map((command) => command.args)).toEqual([["status"]])
    })

    test("reports output and exactly one completion to the sink", async () => {
        const events: string[] = []
        const sink: OperationSink = {
            start: (command) => events.push(`start:${command}`),
            output: (stream, chunk) => events.push(`${stream}:${chunk.trim()}`),
            finish: () => events.push("finish"),
            fail: () => events.push("fail"),
            skip: (message) => events.push(`skip:${message}`),
        }
        const invocation = runWithResult(success, {
            cwd: "/tmp/repository",
            sink,
        })

        await Effect.runPromise(invocation.effect)

        expect(events).toEqual([
            "start:jj git fetch",
            "stdout:fetched",
            "stderr:warning",
            "finish",
        ])
    })

    test("distinguishes normal command failure from process lifecycle failure", async () => {
        const invocation = runWithResult(
            { ...success, exitCode: 1, stderr: "fetch failed" },
            { cwd: "/tmp/repository" },
        )
        const commandExit = await Effect.runPromise(
            Effect.exit(invocation.effect),
        )
        expect(Exit.isFailure(commandExit)).toBe(true)
        if (Exit.isFailure(commandExit)) {
            expect(commandExit.cause.reasons[0]).toMatchObject({
                _tag: "Fail",
                error: expect.any(JjCommandError),
            })
        }

        const processLayer = makeAppProcessFake((command) =>
            Effect.fail(
                new ProcessSpawnError({
                    command,
                    cause: new Error("spawn failed"),
                }),
            ),
        )
        const lifecycleExit = await Effect.runPromise(
            Effect.exit(
                Jj.use((jj) => jj.gitFetch({ cwd: "/tmp/repository" })).pipe(
                    Effect.provide(JjLive),
                    Effect.provide(processLayer),
                ),
            ),
        )
        expect(Exit.isFailure(lifecycleExit)).toBe(true)
        if (Exit.isFailure(lifecycleExit)) {
            expect(lifecycleExit.cause.reasons[0]).toMatchObject({
                _tag: "Fail",
                error: expect.any(ProcessSpawnError),
            })
        }
    })

    test("sink exceptions cannot fail fetch", async () => {
        const sink: OperationSink = {
            start: () => {
                throw new Error("sink failed")
            },
            output: () => {
                throw new Error("sink failed")
            },
            finish: () => {
                throw new Error("sink failed")
            },
            fail: () => {
                throw new Error("sink failed")
            },
            skip: () => {
                throw new Error("sink failed")
            },
        }
        const invocation = runWithResult(success, {
            cwd: "/tmp/repository",
            sink,
        })

        await expect(
            Effect.runPromise(invocation.effect),
        ).resolves.toMatchObject({
            exitCode: 0,
        })
    })
})
