import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { OperationSink } from "../../../src/commander/jj"
import { ConfigSchema } from "../../../src/config"
import { Hooks, makeHooksLayer } from "../../../src/hooks/runner"
import { HookOperation } from "../../../src/hooks/types"
import {
    type ProcessCommand,
    type ProcessResult,
    makeAppProcessFake,
} from "../../../src/process/app-process"

const success: ProcessResult = {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1,
}

function hookConfig(
    commands: Array<string | { command: string; env?: Record<string, string> }>,
) {
    return ConfigSchema.parse({
        gitHooksPath: false,
        repos: {
            "/tmp/repository": {
                hooks: { "jj.new": { pre: commands } },
            },
        },
    })
}

function runHooks(
    commands: Array<string | { command: string; env?: Record<string, string> }>,
    run: (command: ProcessCommand) => Effect.Effect<ProcessResult>,
    options: { verify?: boolean; sink?: OperationSink } = {},
) {
    return Hooks.use((hooks) =>
        hooks.runApplicablePreHooks(HookOperation.JjNew, {
            cwd: "/tmp/repository",
            ...options,
        }),
    ).pipe(
        Effect.provide(makeHooksLayer(() => hookConfig(commands))),
        Effect.provide(makeAppProcessFake(run)),
    )
}

describe("Hooks", () => {
    test("runs configured hooks sequentially with shell and environment policy", async () => {
        const started: ProcessCommand[] = []
        const result = await Effect.runPromise(
            runHooks(
                ["first", { command: "second", env: { TOKEN: "yes" } }],
                (command) => {
                    started.push(command)
                    return Effect.succeed(success)
                },
            ),
        )

        expect(result).toEqual({ success: true })
        expect(started).toMatchObject([
            {
                executable: "sh",
                args: ["-lc", "first"],
                cwd: "/tmp/repository",
            },
            {
                executable: "sh",
                args: ["-lc", "second"],
                cwd: "/tmp/repository",
                env: { TOKEN: "yes" },
            },
        ])
    })

    test("stops before jj new when a configured hook fails", async () => {
        const failure = { ...success, exitCode: 7, stderr: "failed" }
        const result = await Effect.runPromise(
            runHooks(["first", "second"], () => Effect.succeed(failure)),
        )

        expect(result).toEqual({
            success: false,
            command: "first",
            result: failure,
        })
    })

    test("skips all discovery and execution with no-verify", async () => {
        const messages: string[] = []
        const sink: OperationSink = {
            start: () => {},
            output: () => {},
            finish: () => {},
            fail: () => {},
            skip: (message) => messages.push(message),
        }
        let processRuns = 0

        const result = await Effect.runPromise(
            runHooks(
                ["first"],
                () => {
                    processRuns++
                    return Effect.succeed(success)
                },
                { verify: false, sink },
            ),
        )

        expect(result).toEqual({ success: true })
        expect(processRuns).toBe(0)
        expect(messages).toEqual(["pre-hooks for jj.new skipped (--no-verify)"])
    })

    test("reports whether the current repository has a configured hook", async () => {
        const processLayer = makeAppProcessFake(() => Effect.succeed(success))
        const configured = Hooks.use((hooks) =>
            hooks.hasPreHooks(HookOperation.JjNew, "/tmp/repository"),
        ).pipe(
            Effect.provide(makeHooksLayer(() => hookConfig(["first"]))),
            Effect.provide(processLayer),
        )
        const absent = Hooks.use((hooks) =>
            hooks.hasPreHooks(HookOperation.JjNew, "/tmp/repository"),
        ).pipe(
            Effect.provide(makeHooksLayer(() => hookConfig([]))),
            Effect.provide(processLayer),
        )

        await expect(Effect.runPromise(configured)).resolves.toBe(true)
        await expect(Effect.runPromise(absent)).resolves.toBe(false)
    })
})
