import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import {
    isResolvedDetailTarget,
    makeDetailReads,
    prepareCurrentRead,
} from "../../../src/application/detail-reads"

const limits = { maxBytes: 1024, maxEntries: 3, concurrency: 1, maxQueued: 2 }
const size = (value: string) => value.length * 2
const fork = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.forkChild(effect, { startImmediately: true })
const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(effect))

describe("DetailReads", () => {
    test("shares in-flight work while another consumer needs it", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads(limits)
                const read = yield* reads.makeReader<string>()
                const ready = yield* Deferred.make<void>()
                const raw = yield* Deferred.make<string>()
                let calls = 0
                let released = false
                const load = Effect.gen(function* () {
                    calls++
                    yield* Deferred.succeed(ready, undefined)
                    return yield* Deferred.await(raw)
                }).pipe(
                    Effect.ensuring(
                        Effect.sync(() => {
                            released = true
                        }),
                    ),
                )
                const a = yield* fork(read("A", load, size))
                yield* Deferred.await(ready)
                const b = yield* fork(read("A", load, size))
                yield* Fiber.interrupt(a)
                expect(Exit.hasInterrupts(yield* Fiber.await(a))).toBe(true)
                expect(released).toBe(false)
                yield* Deferred.succeed(raw, "A")
                expect(yield* Fiber.join(b)).toBe("A")
                expect(yield* read("A", load, size)).toBe("A")
                expect(calls).toBe(1)
            }),
        ))

    test("A → B → C interrupts obsolete work before preparation or publication", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads(limits)
                const read = yield* reads.makeReader<string>()
                const ready = yield* Deferred.make<void>()
                const raw = yield* Deferred.make<string>()
                const prepared: string[] = []
                const published: string[] = []
                const prepare = (value: string) => {
                    prepared.push(value)
                    return value
                }
                const a = yield* fork(
                    read(
                        "A",
                        prepareCurrentRead(
                            Deferred.succeed(ready, undefined).pipe(
                                Effect.andThen(Deferred.await(raw)),
                                Effect.uninterruptible,
                            ),
                            prepare,
                        ),
                        size,
                    ).pipe(
                        Effect.tap((value) =>
                            Effect.sync(() => {
                                published.push(value)
                            }),
                        ),
                    ),
                )
                yield* Deferred.await(ready)
                const interruptA = yield* fork(Fiber.interrupt(a))
                const b = yield* fork(
                    read("B", prepareCurrentRead(Effect.succeed("B"), prepare), size),
                )
                yield* Fiber.interrupt(b)
                const c = yield* fork(
                    read("C", prepareCurrentRead(Effect.succeed("C"), prepare), size).pipe(
                        Effect.tap((value) =>
                            Effect.sync(() => {
                                published.push(value)
                            }),
                        ),
                    ),
                )
                yield* Deferred.succeed(raw, "late A")
                yield* Fiber.join(interruptA)
                yield* Fiber.join(c)
                expect(prepared).toEqual(["C"])
                expect(published).toEqual(["C"])
            }),
        ))

    test("A → B → A does not share the aborted producer with the new A", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads(limits)
                const read = yield* reads.makeReader<string>()
                const ready = yield* Deferred.make<void>()
                const cleanup = yield* Deferred.make<void>()
                const cleaning = yield* Deferred.make<void>()
                const a = yield* fork(
                    read(
                        "A",
                        Deferred.succeed(ready, undefined).pipe(
                            Effect.andThen(Effect.never),
                            Effect.ensuring(
                                Deferred.succeed(cleaning, undefined).pipe(
                                    Effect.andThen(Deferred.await(cleanup)),
                                ),
                            ),
                        ),
                        size,
                    ),
                )
                yield* Deferred.await(ready)
                const interruptA = yield* fork(Fiber.interrupt(a))
                yield* Deferred.await(cleaning)
                const current = yield* fork(read("A", Effect.succeed("new A"), size))
                yield* Deferred.succeed(cleanup, undefined)
                yield* Fiber.join(interruptA)
                expect(yield* Fiber.join(current)).toBe("new A")
                expect(yield* read("A", Effect.succeed("wrong"), size)).toBe("new A")
            }),
        ))

    test("holds the worker slot until cancelled process cleanup finishes", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads(limits)
                const read = yield* reads.makeReader<string>()
                const ready = yield* Deferred.make<void>()
                const cleaning = yield* Deferred.make<void>()
                const cleanup = yield* Deferred.make<void>()
                let startedB = false
                const a = yield* fork(
                    read(
                        "A",
                        Deferred.succeed(ready, undefined).pipe(
                            Effect.andThen(Effect.never),
                            Effect.ensuring(
                                Deferred.succeed(cleaning, undefined).pipe(
                                    Effect.andThen(Deferred.await(cleanup)),
                                ),
                            ),
                        ),
                        size,
                    ),
                )
                yield* Deferred.await(ready)
                const interruptA = yield* fork(Fiber.interrupt(a))
                yield* Deferred.await(cleaning)
                const b = yield* fork(
                    read(
                        "B",
                        Effect.sync(() => {
                            startedB = true
                            return "B"
                        }),
                        size,
                    ),
                )
                expect(startedB).toBe(false)
                yield* Deferred.succeed(cleanup, undefined)
                yield* Fiber.join(interruptA)
                yield* Fiber.join(b)
                expect(startedB).toBe(true)
            }),
        ))

    test("bounds queued work and admits the newest queued request first", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads(limits)
                const read = yield* reads.makeReader<string>()
                const ready = yield* Deferred.make<void>()
                const raw = yield* Deferred.make<string>()
                const starts: string[] = []
                const a = yield* fork(
                    read(
                        "A",
                        Deferred.succeed(ready, undefined).pipe(
                            Effect.andThen(Deferred.await(raw)),
                        ),
                        size,
                    ),
                )
                yield* Deferred.await(ready)
                const load = (value: string) =>
                    Effect.sync(() => {
                        starts.push(value)
                        return value
                    })
                const b = yield* fork(read("B", load("B"), size))
                const c = yield* fork(read("C", load("C"), size))
                const d = yield* fork(read("D", load("D"), size))
                expect(Exit.hasInterrupts(yield* Fiber.await(b))).toBe(true)
                yield* Deferred.succeed(raw, "A")
                yield* Fiber.join(a)
                yield* Fiber.join(c)
                yield* Fiber.join(d)
                expect(starts).toEqual(["D", "C"])
            }),
        ))

    test("evicts by byte size and recency, and skips oversized results", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads({ ...limits, maxBytes: 500 })
                const read = yield* reads.makeReader<string>()
                let calls = 0
                const load = Effect.sync(() => {
                    calls++
                    return "x".repeat(20)
                })
                yield* read("A", load, size)
                yield* read("B", load, size)
                yield* read("A", load, size)
                yield* read("C", load, size)
                yield* read("A", load, size)
                expect(calls).toBe(3)
                yield* read("B", load, size)
                expect(calls).toBe(4)
                const huge = Effect.sync(() => {
                    calls++
                    return "x".repeat(1000)
                })
                yield* read("huge", huge, size)
                yield* read("huge", huge, size)
                expect(calls).toBe(6)
            }),
        ))

    test("typed readers share the same cache entry budget", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads({ ...limits, maxEntries: 1 })
                const strings = yield* reads.makeReader<string>()
                const numbers = yield* reads.makeReader<number>()
                let calls = 0
                const load = Effect.sync(() => {
                    calls++
                    return ""
                })
                yield* strings("A", load, size)
                yield* numbers("A", Effect.succeed(123), () => 8)
                yield* strings("A", load, size)
                expect(calls).toBe(2)
            }),
        ))

    test("typed readers share the same byte budget", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads({ ...limits, maxBytes: 500 })
                const strings = yield* reads.makeReader<string>()
                const numbers = yield* reads.makeReader<number>()
                let calls = 0
                const load = Effect.sync(() => {
                    calls++
                    return "A"
                })
                yield* strings("A", load, () => 150)
                yield* numbers("A", Effect.succeed(1), () => 150)
                yield* strings("A", load, () => 150)
                expect(calls).toBe(2)
            }),
        ))

    test("typed readers share the same worker pool", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads({ ...limits, concurrency: 2 })
                const strings = yield* reads.makeReader<string>()
                const numbers = yield* reads.makeReader<number>()
                const readyA = yield* Deferred.make<void>()
                const readyB = yield* Deferred.make<void>()
                const rawA = yield* Deferred.make<string>()
                const rawB = yield* Deferred.make<number>()
                let startedC = false
                const a = yield* fork(
                    strings(
                        "A",
                        Deferred.succeed(readyA, undefined).pipe(
                            Effect.andThen(Deferred.await(rawA)),
                        ),
                        size,
                    ),
                )
                const b = yield* fork(
                    numbers(
                        "B",
                        Deferred.succeed(readyB, undefined).pipe(
                            Effect.andThen(Deferred.await(rawB)),
                        ),
                        () => 8,
                    ),
                )
                yield* Deferred.await(readyA)
                yield* Deferred.await(readyB)
                const c = yield* fork(
                    strings(
                        "C",
                        Effect.sync(() => {
                            startedC = true
                            return "C"
                        }),
                        size,
                    ),
                )
                expect(startedC).toBe(false)
                yield* Deferred.succeed(rawA, "A")
                expect(yield* Fiber.join(c)).toBe("C")
                expect(startedC).toBe(true)
                yield* Deferred.succeed(rawB, 1)
                yield* Fiber.join(a)
                yield* Fiber.join(b)
            }),
        ))

    test("invalidation prevents old reads from filling the new cache", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads(limits)
                const read = yield* reads.makeReader<string>()
                const ready = yield* Deferred.make<void>()
                const raw = yield* Deferred.make<string>()
                const first = yield* fork(
                    read(
                        "A",
                        Deferred.succeed(ready, undefined).pipe(
                            Effect.andThen(Deferred.await(raw)),
                        ),
                        size,
                    ),
                )
                yield* Deferred.await(ready)
                yield* reads.invalidate()
                const second = yield* fork(read("A", Effect.succeed("fresh"), size))
                yield* Deferred.succeed(raw, "old")
                expect(yield* Fiber.join(first)).toBe("old")
                expect(yield* Fiber.join(second)).toBe("fresh")
                expect(yield* read("A", Effect.succeed("wrong"), size)).toBe("fresh")
                yield* reads.invalidate()
                expect(yield* read("A", Effect.succeed("new generation"), size)).toBe(
                    "new generation",
                )
            }),
        ))

    test("does not retain typed failures, defects, interruptions, or mutable reads", () =>
        run(
            Effect.gen(function* () {
                const reads = yield* makeDetailReads(limits)
                const read = yield* reads.makeReader<string, string>()
                const failed = yield* Effect.exit(read("A", Effect.fail("failed"), size))
                expect(Exit.hasFails(failed)).toBe(true)
                const defect = yield* Effect.exit(read("A", Effect.die("defect"), size))
                expect(Exit.hasDies(defect)).toBe(true)
                const interrupted = yield* Effect.exit(read("A", Effect.interrupt, size))
                expect(Exit.hasInterrupts(interrupted)).toBe(true)
                expect(yield* read("A", Effect.succeed("retry"), size)).toBe("retry")
                let calls = 0
                const load = Effect.sync(() => String(++calls))
                expect(yield* read("symbol", load, size, false)).toBe("1")
                expect(yield* read("symbol", load, size, false)).toBe("2")
            }),
        ))

    test("closing the service scope interrupts running and queued reads", () =>
        run(
            Effect.gen(function* () {
                const serviceScope = yield* Scope.make()
                const reads = yield* makeDetailReads(limits).pipe(Scope.provide(serviceScope))
                const read = yield* reads.makeReader<string>()
                const ready = yield* Deferred.make<void>()
                let released = false
                let queuedStarted = false
                const a = yield* fork(
                    read(
                        "A",
                        Deferred.succeed(ready, undefined).pipe(
                            Effect.andThen(Effect.never),
                            Effect.ensuring(
                                Effect.sync(() => {
                                    released = true
                                }),
                            ),
                        ),
                        size,
                    ),
                )
                yield* Deferred.await(ready)
                const b = yield* fork(
                    read(
                        "B",
                        Effect.sync(() => {
                            queuedStarted = true
                            return "B"
                        }),
                        size,
                    ),
                )
                yield* Scope.close(serviceScope, Exit.void)
                expect(Exit.hasInterrupts(yield* Fiber.await(a))).toBe(true)
                expect(Exit.hasInterrupts(yield* Fiber.await(b))).toBe(true)
                expect(released).toBe(true)
                expect(queuedStarted).toBe(false)
                expect(
                    Exit.hasInterrupts(yield* Effect.exit(read("C", Effect.succeed("C"), size))),
                ).toBe(true)
            }),
        ))
})

test("reusable targets require full commit IDs, including every union member", () => {
    const a = "a".repeat(40)
    const b = "b".repeat(40)
    expect(isResolvedDetailTarget({ revision: a })).toBe(true)
    expect(isResolvedDetailTarget({ revision: `${a} | ${b}` })).toBe(true)
    expect(isResolvedDetailTarget({ from: a, to: b })).toBe(true)
    for (const revision of [
        "@",
        "main",
        "abc123",
        "z".repeat(32),
        `${a}::${b}`,
        `${a} | main`,
        "",
    ]) {
        expect(isResolvedDetailTarget({ revision })).toBe(false)
    }
    expect(isResolvedDetailTarget({ from: "main@origin", to: "main" })).toBe(false)
})
