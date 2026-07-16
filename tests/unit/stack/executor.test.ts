import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import type { Bookmark } from "../../../src/commander/bookmarks"
import {
    GitHub,
    type GitHubService,
} from "../../../src/commander/github-service"
import { Jj, type JjService } from "../../../src/commander/jj"
import type { Commit } from "../../../src/commander/types"
import {
    Stack,
    StackApplyError,
    StackLive,
    StackPlanStaleError,
    type StackService,
} from "../../../src/stack/executor"
import type { PersistedStackState } from "../../../src/stack/state"
import {
    type StackJournal,
    StackStore,
    type StackStoreService,
} from "../../../src/stack/store"

const mainCommit = commit("main", [], true)
const parentCommit = commit("a", ["main"])
const childCommit = commit("b", ["a"])

const mainBookmark = bookmark("main", "main", "main")
const parentBookmark = bookmark("feature-a", "a", "a")
const childBookmark = bookmark("feature-b", "b", "b")
const remoteParent = {
    ...bookmark("feature-a", "old-a", "old-a"),
    isLocal: false,
    remote: "origin",
}

const success = {
    command: "command",
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1,
}

interface FakeOptions {
    readonly calls?: string[]
    readonly journals?: StackJournal[]
    readonly commitId?: () => string
    readonly failPush?: boolean
    readonly pushActivity?: { active: number; max: number }
    readonly bookmarks?: () => readonly Bookmark[]
}

function makeServices(options: FakeOptions = {}) {
    const calls = options.calls ?? []
    const journals = options.journals ?? []
    const commits = () => [
        childCommit,
        parentCommit,
        {
            ...mainCommit,
            commitId: options.commitId?.() ?? mainCommit.commitId,
        },
    ]
    const allBookmarks = () =>
        options.bookmarks?.() ?? [
            mainBookmark,
            parentBookmark,
            childBookmark,
            remoteParent,
        ]
    const pullRequests = new Map([
        [
            "feature-a",
            {
                number: 10,
                headRefName: "feature-a",
                baseRefName: "old",
                state: "OPEN",
                merged: false,
            },
        ],
    ])

    const jj = {
        logPage: () => Effect.succeed({ commits: commits(), hasMore: false }),
        bookmarks: () => Effect.succeed([...allBookmarks()]),
        gitFetch: () => {
            calls.push("fetch")
            return Effect.succeed(success)
        },
        revsetHasMatches: () => Effect.succeed(false),
        operationId: () => Effect.succeed("operation-id"),
        abandon: (revision: string) => {
            calls.push(`abandon:${revision}`)
            return Effect.succeed(success)
        },
        rebase: (revision: string, destination: string) => {
            calls.push(`rebase:${revision}:${destination}`)
            return Effect.succeed(success)
        },
        gitPush: (input: { readonly bookmarks?: readonly string[] }) => {
            calls.push(`push:${input.bookmarks?.join(",")}`)
            if (options.failPush) return Effect.fail(new Error("push failed"))
            const activity = options.pushActivity
            if (!activity) return Effect.succeed(success)
            return Effect.gen(function* () {
                activity.active++
                activity.max = Math.max(activity.max, activity.active)
                yield* Effect.sleep("5 millis")
                activity.active--
                return success
            })
        },
    } as unknown as JjService

    const gitHub = {
        listPullRequestsByHead: (heads: readonly string[]) => {
            if (heads.length === 1 && heads[0] === "feature-b") {
                return Effect.succeed(
                    new Map([
                        [
                            "feature-b",
                            {
                                number: 11,
                                headRefName: "feature-b",
                                baseRefName: "feature-a",
                                state: "OPEN",
                            },
                        ],
                    ]),
                )
            }
            return Effect.succeed(new Map(pullRequests))
        },
        prCreate: (input: { readonly head: string; readonly base: string }) => {
            calls.push(`create:${input.head}:${input.base}`)
            return Effect.succeed(success)
        },
        prEditBase: (number: number, base: string) => {
            calls.push(`edit:${number}:${base}`)
            return Effect.succeed(success)
        },
        prClose: (number: number) => {
            calls.push(`close:${number}`)
            return Effect.succeed(success)
        },
        upsertStackComment: (number: number) => {
            calls.push(`comment:${number}`)
            return Effect.succeed(success)
        },
    } as unknown as GitHubService

    const emptyState: PersistedStackState = { version: 1, entries: [] }
    const store = {
        readState: () => Effect.succeed(emptyState),
        writeState: () => {
            calls.push("state")
            return Effect.void
        },
        writeJournal: (_cwd: string, journal: StackJournal) => {
            journals.push(structuredClone(journal))
            calls.push(`journal:${journal.entries.length}`)
            return Effect.void
        },
    } satisfies StackStoreService

    return { jj, gitHub, store, calls, journals }
}

function runStack<A, E>(
    services: ReturnType<typeof makeServices>,
    operation: (stack: StackService) => Effect.Effect<A, E>,
): Promise<A> {
    const dependencies = Layer.mergeAll(
        Layer.succeed(Jj, Jj.of(services.jj)),
        Layer.succeed(GitHub, GitHub.of(services.gitHub)),
        Layer.succeed(StackStore, StackStore.of(services.store)),
    )
    return Effect.runPromise(
        Stack.use(operation).pipe(
            Effect.provide(StackLive),
            Effect.provide(dependencies),
        ),
    )
}

const prepare = (stack: StackService) =>
    stack.prepareSyncPlan({
        cwd: "/tmp/repository",
        stackRootName: "feature-a",
    })

describe("Stack", () => {
    test("prepares a plan through supplied jj, GitHub, and state services", async () => {
        const services = makeServices()
        const plan = await runStack(services, prepare)

        expect(services.calls).toEqual(["fetch"])
        expect(plan.updatePrNumbers).toEqual([10])
        expect(plan.createPrBookmarks).toEqual(["feature-b"])
        expect(plan.pushBookmarks).toEqual(["feature-a", "feature-b"])
    })

    test("validates, journals, and applies a prepared plan", async () => {
        const services = makeServices()
        const plan = await runStack(services, prepare)
        services.calls.length = 0

        await runStack(services, (stack) =>
            stack.applyStackPlan(plan, { cwd: "/tmp/repository" }),
        )

        expect(services.calls[0]).toBe("journal:0")
        expect(services.calls).toContain("push:feature-b")
        expect(services.calls).toContain("create:feature-b:feature-a")
        expect(services.calls).toContain("edit:10:main")
        expect(services.calls).toContain("state")
        expect(services.journals.at(-1)?.afterOperationId).toBe("operation-id")
        for (let index = 1; index < services.journals.length; index++) {
            expect(
                services.journals[index]?.entries.length,
            ).toBeGreaterThanOrEqual(
                services.journals[index - 1]?.entries.length ?? 0,
            )
        }
    })

    test("rejects a stale plan before writing a journal or mutating", async () => {
        let changedCommitId = "main"
        const services = makeServices({ commitId: () => changedCommitId })
        const plan = await runStack(services, prepare)
        services.calls.length = 0
        changedCommitId = "changed-main"

        await expect(
            runStack(services, (stack) =>
                stack.applyStackPlan(plan, { cwd: "/tmp/repository" }),
            ),
        ).rejects.toBeInstanceOf(StackPlanStaleError)
        expect(services.calls).toEqual([])
        expect(services.journals).toEqual([])
    })

    test("serializes concurrent applies for one repository", async () => {
        const activity = { active: 0, max: 0 }
        const services = makeServices({ pushActivity: activity })
        const plan = await runStack(services, prepare)
        services.calls.length = 0

        await runStack(services, (stack) =>
            Effect.all(
                [
                    stack.applyStackPlan(plan, { cwd: "/tmp/repository" }),
                    stack.applyStackPlan(plan, { cwd: "/tmp/repository" }),
                ],
                { concurrency: "unbounded" },
            ),
        )

        expect(activity.max).toBe(1)
    })

    test("reports only durably journaled steps after partial failure", async () => {
        const services = makeServices({ failPush: true })
        const plan = await runStack(services, prepare)
        services.calls.length = 0

        try {
            await runStack(services, (stack) =>
                stack.applyStackPlan(plan, { cwd: "/tmp/repository" }),
            )
            throw new Error("expected stack apply to fail")
        } catch (error) {
            expect(error).toBeInstanceOf(StackApplyError)
            expect((error as StackApplyError).completedEntries).toEqual([])
        }
        expect(
            services.journals.map((journal) => journal.entries.length),
        ).toEqual([0])
    })
})

function commit(
    commitId: string,
    parentCommitIds: readonly string[],
    immutable = false,
): Commit {
    return {
        changeId: `${commitId}-change`,
        commitId,
        parentCommitIds: [...parentCommitIds],
        description: commitId,
        author: "Test",
        authorEmail: "test@example.com",
        timestamp: "2026-01-01T00:00:00Z",
        lines: [],
        displayLines: [],
        refLine: "",
        isWorkingCopy: false,
        immutable,
        inTrunk: immutable,
        empty: false,
        divergent: false,
        bookmarks: [],
        gitHead: false,
        workingCopies: [],
    }
}

function bookmark(name: string, commitId: string, changeId: string): Bookmark {
    return {
        name,
        nameDisplay: name,
        changeId,
        commitId,
        changeIdDisplay: changeId.slice(0, 8),
        commitIdDisplay: commitId.slice(0, 8),
        descriptionDisplay: name,
        description: name,
        isLocal: true,
    }
}
