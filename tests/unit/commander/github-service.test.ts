import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { GitLive } from "../../../src/commander/git"
import {
    GitHub,
    GitHubLive,
    type GitHubService,
} from "../../../src/commander/github-service"
import {
    type ProcessCommand,
    type ProcessError,
    type ProcessResult,
    makeAppProcessFake,
} from "../../../src/process/app-process"
import type { OperationSink } from "../../../src/process/operation-sink"

const success = {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1,
}

function runWithFake<A, E>(
    run: (
        command: ProcessCommand,
    ) => Effect.Effect<ProcessResult, ProcessError>,
    operation: (gitHub: GitHubService) => Effect.Effect<A, E>,
) {
    const processLayer = makeAppProcessFake(run)
    const gitLayer = GitLive.pipe(Layer.provide(processLayer))
    const dependencies = Layer.merge(processLayer, gitLayer)
    return Effect.runPromise(
        GitHub.use(operation).pipe(
            Effect.provide(GitHubLive),
            Effect.provide(dependencies),
        ),
    )
}

describe("GitHub", () => {
    test("resolves the origin repository and lists pull requests by head", async () => {
        const commands: ProcessCommand[] = []
        const pulls = await runWithFake(
            (command) => {
                commands.push(command)
                if (command.executable === "git") {
                    return Effect.succeed({
                        ...success,
                        stdout: "git@github.com:eliaskc/kajji.git\n",
                    })
                }
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
                })
            },
            (gitHub) =>
                gitHub.listPullRequestsByHead(["feature", "feature"], {
                    cwd: "/tmp/repository",
                }),
        )

        expect(pulls.get("feature")?.number).toBe(42)
        expect(commands[0]).toMatchObject({
            executable: "git",
            args: ["remote", "get-url", "origin"],
            cwd: "/tmp/repository",
        })
        expect(commands[1]?.executable).toBe("gh")
        expect(commands[1]?.args.slice(0, 2)).toEqual(["api", "graphql"])
        expect(commands[1]?.args).toContain("owner=eliaskc")
        expect(commands[1]?.args).toContain("name=kajji")
    })

    test("constructs browser operations and reports output to the sink", async () => {
        const commands: ProcessCommand[] = []
        const events: string[] = []
        const sink: OperationSink = {
            start: (command, kind) => events.push(`start:${kind}:${command}`),
            output: (stream, chunk) => events.push(`${stream}:${chunk}`),
            finish: (result) => events.push(`finish:${result.exitCode}`),
            fail: (error) => events.push(`fail:${error._tag}`),
            skip: () => {},
        }

        const result = await runWithFake(
            (command) => {
                commands.push(command)
                command.onOutput?.("stdout", "opened\n")
                return Effect.succeed({ ...success, stdout: "opened\n" })
            },
            (gitHub) =>
                gitHub.prCreateWeb("feature", {
                    cwd: "/tmp/repository",
                    sink,
                }),
        )

        expect(commands[0]?.args).toEqual([
            "pr",
            "create",
            "--web",
            "--head",
            "feature",
        ])
        expect(result.command).toBe("gh pr create --web --head feature")
        expect(events).toEqual([
            "start:shell:gh pr create --web --head feature",
            "stdout:opened\n",
            "finish:0",
        ])
    })
})
