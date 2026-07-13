import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import {
    Jj,
    JjCommandError,
    type JjGitFetchOptions,
    JjLive,
    type OperationSink,
} from "../../../src/commander/jj"
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

    test("reports output and exactly one completion to the sink", async () => {
        const events: string[] = []
        const sink: OperationSink = {
            start: (command) => events.push(`start:${command}`),
            output: (stream, chunk) => events.push(`${stream}:${chunk.trim()}`),
            finish: () => events.push("finish"),
            fail: () => events.push("fail"),
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
