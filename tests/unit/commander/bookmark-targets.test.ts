import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { makeApplicationClient } from "../../../src/application/client"
import {
    type Bookmark,
    BOOKMARK_REFERENCE_TEMPLATE,
    BOOKMARK_TEMPLATE,
    applyBookmarkTargets,
    createBookmarkTargetAccumulator,
    groupBookmarkTargetReads,
    parseBookmarkOutput,
} from "../../../src/commander/bookmarks"
import { Jj, JjLive } from "../../../src/commander/jj"
import {
    AppProcess,
    AppProcessLive,
    type ProcessCommand,
    makeAppProcessFake,
} from "../../../src/process/app-process"

const operationId = "f".repeat(128)
const firstId = "a".repeat(40)
const secondId = "b".repeat(40)
const success = { stdout: "", stderr: "", exitCode: 0, durationMs: 0 }
const line = (name: string, id: string, remote = "", description = "") =>
    `__BJ__${name}__BJ__${name}__BJ__${remote}__BJ__${name}-change__BJ__${name}-commit__BJ__change-${id}__BJ__${id}__BJ__${description}\n`
const reference = (name: string, id: string, remote = ""): Bookmark =>
    parseBookmarkOutput(line(name, id, remote))[0]!

const runBookmarks = (processLayer: ReturnType<typeof makeAppProcessFake>) =>
    Effect.runPromise(
        Jj.use((jj) =>
            jj
                .streamBookmarks({
                    cwd: "/tmp/repository",
                    atOperation: operationId,
                    allRemotes: true,
                })
                .pipe(Stream.runCollect),
        ).pipe(Effect.provide(JjLive), Effect.provide(processLayer)),
    )

const outputEvents = (stdout: string) =>
    Stream.fromIterable([
        { _tag: "Output" as const, stream: "stdout" as const, chunk: stdout.slice(0, 17) },
        { _tag: "Output" as const, stream: "stdout" as const, chunk: stdout.slice(17) },
        { _tag: "Complete" as const, result: { ...success, stdout } },
    ])

describe("shared bookmark targets", () => {
    test("chooses one representative per target, preferring local references", () => {
        const groups = groupBookmarkTargetReads([
            reference("remote", firstId, "origin"),
            reference("local", firstId),
            reference("other-local", firstId),
            reference("remote-only", secondId, "origin"),
        ])
        expect(groups).toEqual([
            { remote: "", names: ["other-local"] },
            { remote: "origin", names: ["remote-only"] },
        ])
    })

    test("bounds argument bytes and reference count without dropping names", () => {
        const refs = Array.from({ length: 600 }, (_, i) => reference(`branch-${i}`, String(i)))
        const groups = groupBookmarkTargetReads(refs)
        expect(groups.map((group) => group.names.length)).toEqual([256, 256, 88])
        expect(groups.flatMap((group) => group.names)).toEqual(refs.map((ref) => ref.name))
        const longRefs = Array.from({ length: 20 }, (_, i) =>
            reference(`${i}-${"雪".repeat(500)}`, String(i)),
        )
        const longGroups = groupBookmarkTargetReads(longRefs)
        for (const group of longGroups) {
            expect(
                group.names.reduce(
                    (sum, name) => sum + new TextEncoder().encode(name).length + 7,
                    0,
                ),
            ).toBeLessThanOrEqual(16_384)
        }
        expect(longGroups.flatMap((group) => group.names)).toHaveLength(20)
    })

    test("preserves reference identity and formatting while joining descriptions", () => {
        const refs = [reference("local", firstId), reference("remote", firstId, "origin")]
        const target = {
            ...reference("representative", firstId),
            description: "empty",
            descriptionDisplay: "\x1b[31mempty\x1b[0m",
        }
        expect(applyBookmarkTargets(refs, [target])).toEqual(
            refs.map((ref) => ({
                ...ref,
                description: target.description,
                descriptionDisplay: target.descriptionDisplay,
            })),
        )
        expect(applyBookmarkTargets(refs, [])).toBeUndefined()
        expect(applyBookmarkTargets([], [])).toEqual([])
    })

    test("out-of-order metadata publishes only complete prefixes and stable snapshots", () => {
        const refs = [
            reference("one", firstId),
            reference("two", secondId),
            reference("three", firstId, "origin"),
        ]
        const accumulator = createBookmarkTargetAccumulator(refs)
        const first = accumulator.add([{ ...refs[0]!, description: "first" }])
        expect(first).toHaveLength(1)
        expect(accumulator.complete()).toBeUndefined()
        const next = accumulator.add([{ ...refs[1]!, description: "second" }])
        expect(next?.map((ref) => ref.description)).toEqual(["first", "second", "first"])
        expect(first).toHaveLength(1)
        expect(next?.[0]).toBe(first?.[0])
        expect(accumulator.complete()).toEqual(next)
        const reversed = createBookmarkTargetAccumulator(refs)
        expect(reversed.add([refs[1]!])).toBeUndefined()
        expect(reversed.add([refs[0]!])).toHaveLength(3)
    })

    test("pins all reads and streams hydrated references without duplicate target reads", async () => {
        const commands: ProcessCommand[] = []
        const refs =
            line("local", firstId) +
            line("local", firstId, "origin") +
            line("remote-only", secondId, "origin")
        const events = await runBookmarks(
            makeAppProcessFake(
                (command) => {
                    commands.push(command)
                    expect(command.args).toContain(BOOKMARK_REFERENCE_TEMPLATE)
                    return Effect.succeed({ ...success, stdout: refs })
                },
                (command) => {
                    commands.push(command)
                    return outputEvents(
                        command.args.includes("exact:local")
                            ? line("local", firstId, "", "first description")
                            : line("remote-only", secondId, "origin", "second description"),
                    )
                },
            ),
        )
        expect(commands).toHaveLength(3)
        for (const command of commands)
            expect(command.args.slice(-2)).toEqual(["--at-operation", operationId])
        const final = events.at(-1)
        expect(final?._tag).toBe("Complete")
        if (final?._tag !== "Complete") throw new Error("missing completion")
        expect(final.result).toEqual(
            parseBookmarkOutput(
                line("local", firstId, "", "first description") +
                    line("local", firstId, "origin", "first description") +
                    line("remote-only", secondId, "origin", "second description"),
            ),
        )
        expect(events.some((event) => event._tag === "Batch")).toBe(true)
        expect(events.filter((event) => event._tag === "Complete")).toHaveLength(1)
    })

    test.each(["", `${firstId},${secondId}`])(
        "falls back for absent or conflicted targets: %s",
        async (id) => {
            const output = line("conflicted", id, "", "original conflict text")
            let streamed = 0
            const events = await runBookmarks(
                makeAppProcessFake(
                    () => Effect.succeed({ ...success, stdout: output }),
                    (command) => {
                        streamed++
                        expect(command.args).toContain(BOOKMARK_TEMPLATE)
                        return outputEvents(output)
                    },
                ),
            )
            expect(streamed).toBe(1)
            expect(events.at(-1)).toEqual({ _tag: "Complete", result: parseBookmarkOutput(output) })
        },
    )

    test("empty reference list completes without metadata reads", async () => {
        const events = await runBookmarks(
            makeAppProcessFake(
                () => Effect.succeed(success),
                () => {
                    throw new Error("unexpected metadata read")
                },
            ),
        )
        expect(events).toEqual([{ _tag: "Complete", result: [] }])
    })

    test("metadata errors remain errors rather than a successful partial list", async () => {
        const effect = runBookmarks(
            makeAppProcessFake(
                () => Effect.succeed({ ...success, stdout: line("one", firstId) }),
                () =>
                    Stream.succeed({
                        _tag: "Complete" as const,
                        result: { ...success, exitCode: 1, stderr: "metadata read failed" },
                    }),
            ),
        )
        await expect(effect).rejects.toMatchObject({ _tag: "JjReadError" })
    })

    test("interrupting a shared read cancels every active metadata stream", async () => {
        const started = Deferred.makeUnsafe<void>()
        let active = 0
        let stopped = 0
        const refs = line("local", firstId) + line("remote", secondId, "origin")
        const processLayer = makeAppProcessFake(
            () => Effect.succeed({ ...success, stdout: refs }),
            () =>
                Stream.fromEffect(
                    Effect.gen(function* () {
                        active++
                        if (active === 2) yield* Deferred.succeed(started, undefined)
                        return yield* Effect.never
                    }),
                ).pipe(
                    Stream.ensuring(
                        Effect.sync(() => {
                            stopped++
                        }),
                    ),
                ),
        )
        await Effect.runPromise(
            Effect.gen(function* () {
                const jj = yield* Jj
                const fiber = yield* jj
                    .streamBookmarks({
                        cwd: "/tmp/repository",
                        atOperation: operationId,
                        allRemotes: true,
                    })
                    .pipe(Stream.runDrain, Effect.forkScoped)
                yield* Deferred.await(started)
                yield* Fiber.interrupt(fiber)
                expect(active).toBe(2)
                expect(stopped).toBe(2)
            }).pipe(Effect.scoped, Effect.provide(JjLive), Effect.provide(processLayer)),
        )
    })

    test("real shared reads preserve colors, remote targets, empty targets and conflicts", async () => {
        const root = await mkdtemp(join(tmpdir(), "kajji-bookmark-targets-"))
        const config = join(root, "jj.toml")
        await writeFile(
            config,
            `[user]\nname="Bookmark test"\nemail="bookmark@example.com"\n[fsmonitor]\nbackend="none"\n[colors]\n"bookmark_list empty"="red"\n"bookmark_list description placeholder"="blue"\n"log commit empty"="green"\n[template-aliases]\n"format_short_change_id(id)"='label("change_id", "custom:" ++ id.short(6))'\n`,
        )
        const env = { ...process.env, JJ_CONFIG: config }
        const run = (...args: string[]) => {
            const result = Bun.spawnSync(args, { cwd: root, env, stdout: "pipe", stderr: "pipe" })
            if (!result.success) throw new Error(result.stderr.toString())
            return result.stdout.toString().trim()
        }
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
        const compare = async () => {
            const state = await client.jjRefreshState({ cwd: root })
            const options = { cwd: root, atOperation: state.operationId, allRemotes: true }
            const expected = await client.jjBookmarks(options)
            const actual = await client.jjStreamBookmarks(options, (batch) => {
                // Validate a complete prefix on every callback, not just the final list.
                expect(batch).toEqual(expected.slice(0, batch.length))
            }).result
            expect(actual).toEqual(expected)
            return actual
        }
        try {
            run("jj", "git", "init", "--colocate")
            await writeFile(join(root, "file.txt"), "nonempty base\n")
            run("jj", "describe", "-m", "base description")
            const base = run("jj", "log", "--no-graph", "-r", "@", "-T", "commit_id")
            run("jj", "bookmark", "create", "local-a", "local-b", "feature/snow-雪", "-r", "@")
            run("jj", "new", "-m", "")
            const empty = run("jj", "log", "--no-graph", "-r", "@", "-T", "commit_id")
            run("jj", "bookmark", "create", "empty", "-r", "@")
            run("git", "remote", "add", "origin", root)
            run("git", "update-ref", "refs/remotes/origin/local-a", base)
            run("git", "update-ref", "refs/remotes/origin/remote-only", empty)
            run("jj", "git", "import")
            run("jj", "bookmark", "track", "local-a@origin")
            const normal = await compare()
            expect(normal.some((bookmark) => bookmark.remote === "origin")).toBe(true)
            expect(normal.find((bookmark) => bookmark.name === "empty")?.description).toBe(
                "(empty) (no description set)",
            )
            run("jj", "bookmark", "set", "local-a", "-r", empty)
            await compare()
            run("jj", "bookmark", "delete", "local-a")
            const deleted = await compare()
            expect(
                deleted.some(
                    (bookmark) =>
                        bookmark.isLocal && bookmark.name === "local-a" && !bookmark.commitId,
                ),
            ).toBe(true)
            run("jj", "bookmark", "forget", "local-a")
            run("jj", "new", base, "-m", "left")
            const left = run("jj", "log", "--no-graph", "-r", "@", "-T", "commit_id")
            run("jj", "new", base, "-m", "right")
            const right = run("jj", "log", "--no-graph", "-r", "@", "-T", "commit_id")
            run("jj", "bookmark", "create", "conflicted", "-r", base)
            const operation = run(
                "jj",
                "op",
                "log",
                "--no-graph",
                "--limit",
                "1",
                "-T",
                "self.id()",
            )
            run("jj", "--at-operation", operation, "bookmark", "set", "conflicted", "-r", left)
            run("jj", "--at-operation", operation, "bookmark", "set", "conflicted", "-r", right)
            const conflicted = await compare()
            expect(
                conflicted.find((bookmark) => bookmark.name === "conflicted")?.commitId,
            ).toContain(",")
        } finally {
            await client.dispose()
            await rm(root, { recursive: true, force: true })
        }
    })
})
