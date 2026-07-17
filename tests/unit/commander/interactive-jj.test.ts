import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
    InteractiveJj,
    InteractiveJjLive,
} from "../../../src/commander/interactive-jj"
import {
    type InteractiveProcessCommand,
    makeInteractiveProcessFake,
} from "../../../src/process/interactive-process"

describe("InteractiveJj", () => {
    test("constructs split, resolve, and interactive squash commands", async () => {
        const commands: InteractiveProcessCommand[] = []
        const processLayer = makeInteractiveProcessFake((command) => {
            commands.push(command)
            return Effect.succeed({ exitCode: 0, durationMs: 10 })
        })
        const effect = Effect.all(
            [
                InteractiveJj.use((jj) =>
                    jj.split("split", {
                        cwd: "/tmp/repository",
                        ignoreImmutable: true,
                    }),
                ),
                InteractiveJj.use((jj) =>
                    jj.resolve({
                        cwd: "/tmp/repository",
                        revision: "resolve",
                        tool: "meld",
                        paths: ["one", "two"],
                    }),
                ),
                InteractiveJj.use((jj) =>
                    jj.squash("squash", {
                        cwd: "/tmp/repository",
                        into: "target",
                        useDestinationMessage: true,
                        keepEmptied: true,
                        ignoreImmutable: true,
                    }),
                ),
            ],
            { concurrency: 1 },
        ).pipe(Effect.provide(InteractiveJjLive), Effect.provide(processLayer))

        const results = await Effect.runPromise(effect)

        expect(commands).toEqual([
            {
                executable: "jj",
                args: ["split", "-r", "split", "--ignore-immutable"],
                cwd: "/tmp/repository",
            },
            {
                executable: "jj",
                args: [
                    "resolve",
                    "-r",
                    "resolve",
                    "--tool",
                    "meld",
                    "one",
                    "two",
                ],
                cwd: "/tmp/repository",
            },
            {
                executable: "jj",
                args: [
                    "squash",
                    "-i",
                    "--from",
                    "squash",
                    "--into",
                    "target",
                    "-u",
                    "-k",
                    "--ignore-immutable",
                ],
                cwd: "/tmp/repository",
            },
        ])
        expect(results).toEqual([
            { command: "jj split -r split --ignore-immutable", exitCode: 0 },
            {
                command: "jj resolve -r resolve --tool meld one two",
                exitCode: 0,
            },
            {
                command:
                    "jj squash -i --from squash --into target -u -k --ignore-immutable",
                exitCode: 0,
            },
        ])
    })
})
