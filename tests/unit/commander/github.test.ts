import { describe, expect, test } from "bun:test"
import {
    parseGhPullRequestsByHeadGraphqlJson,
    parseGhPullRequestsByHeadGraphqlJsonIncludingClosed,
    parseGhRepositoryJson,
    parseGitHubRemoteUrl,
} from "../../../src/commander/github"

describe("parseGhRepositoryJson", () => {
    test("parses owner and repo name", () => {
        expect(
            parseGhRepositoryJson(
                JSON.stringify({ owner: { login: "eliaskc" }, name: "kajji" }),
            ),
        ).toEqual({ owner: "eliaskc", name: "kajji" })
    })
})

describe("parseGitHubRemoteUrl", () => {
    test("parses ssh and https GitHub remotes", () => {
        expect(
            parseGitHubRemoteUrl("git@github.com:MDLabs/apnea-sdk-ios"),
        ).toEqual({
            owner: "MDLabs",
            name: "apnea-sdk-ios",
        })
        expect(
            parseGitHubRemoteUrl("https://github.com/eliaskc/kajji.git"),
        ).toEqual({ owner: "eliaskc", name: "kajji" })
    })

    test("ignores non-GitHub remotes", () => {
        expect(
            parseGitHubRemoteUrl("git@example.com:owner/repo.git"),
        ).toBeUndefined()
    })
})

describe("parseGhPullRequestsByHeadGraphqlJson", () => {
    test("parses PR number by head ref from aliased refs", () => {
        const pulls = parseGhPullRequestsByHeadGraphqlJson(
            JSON.stringify({
                data: {
                    repository: {
                        h0: {
                            associatedPullRequests: {
                                nodes: [
                                    {
                                        number: 123,
                                        headRefName: "feature-a",
                                        baseRefName: "main",
                                        state: "OPEN",
                                    },
                                ],
                            },
                        },
                        h1: {
                            associatedPullRequests: {
                                nodes: [
                                    { number: 124, headRefName: "feature-b" },
                                ],
                            },
                        },
                    },
                },
            }),
        )

        expect([...pulls.entries()]).toEqual([
            [
                "feature-a",
                {
                    number: 123,
                    headRefName: "feature-a",
                    baseRefName: "main",
                    state: "OPEN",
                },
            ],
            ["feature-b", { number: 124, headRefName: "feature-b" }],
        ])
    })

    test("skips closed PRs defensively", () => {
        const pulls = parseGhPullRequestsByHeadGraphqlJson(
            JSON.stringify({
                data: {
                    repository: {
                        h0: {
                            associatedPullRequests: {
                                nodes: [
                                    {
                                        number: 123,
                                        headRefName: "feature-a",
                                        baseRefName: "main",
                                        state: "CLOSED",
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        )

        expect([...pulls.values()]).toEqual([])
    })

    test("prefers latest PR for the same head", () => {
        const pulls = parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(
            JSON.stringify({
                data: {
                    repository: {
                        h0: {
                            associatedPullRequests: {
                                nodes: [
                                    {
                                        number: 100,
                                        headRefName: "feature-a",
                                        baseRefName: "main",
                                        state: "CLOSED",
                                        merged: false,
                                        updatedAt: "2026-01-01T00:00:00Z",
                                    },
                                    {
                                        number: 110,
                                        headRefName: "feature-a",
                                        baseRefName: "main",
                                        state: "OPEN",
                                        merged: false,
                                        updatedAt: "2026-01-02T00:00:00Z",
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        )

        expect(pulls.get("feature-a")?.number).toBe(110)
    })

    test("prefers newer unmerged closed PR over older merged PR", () => {
        const pulls = parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(
            JSON.stringify({
                data: {
                    repository: {
                        h0: {
                            associatedPullRequests: {
                                nodes: [
                                    {
                                        number: 112,
                                        headRefName: "feature-a",
                                        state: "CLOSED",
                                        merged: false,
                                        updatedAt: "2026-01-03T00:00:00Z",
                                    },
                                    {
                                        number: 114,
                                        headRefName: "feature-a",
                                        state: "MERGED",
                                        merged: true,
                                        updatedAt: "2026-01-02T00:00:00Z",
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        )

        expect(pulls.get("feature-a")?.number).toBe(112)
    })

    test("prefers newest closed PR for the same head", () => {
        const pulls = parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(
            JSON.stringify({
                data: {
                    repository: {
                        h0: {
                            associatedPullRequests: {
                                nodes: [
                                    {
                                        number: 100,
                                        headRefName: "feature-a",
                                        state: "CLOSED",
                                        merged: false,
                                        updatedAt: "2026-01-01T00:00:00Z",
                                    },
                                    {
                                        number: 110,
                                        headRefName: "feature-a",
                                        state: "CLOSED",
                                        merged: false,
                                        updatedAt: "2026-01-02T00:00:00Z",
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        )

        expect(pulls.get("feature-a")?.number).toBe(110)
    })

    test("can include closed PRs with merged state for sync planning", () => {
        const pulls = parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(
            JSON.stringify({
                data: {
                    repository: {
                        h0: {
                            associatedPullRequests: {
                                nodes: [
                                    {
                                        number: 123,
                                        headRefName: "feature-a",
                                        baseRefName: "main",
                                        state: "CLOSED",
                                        merged: false,
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        )

        expect(pulls.get("feature-a")).toEqual({
            number: 123,
            headRefName: "feature-a",
            baseRefName: "main",
            state: "CLOSED",
            merged: false,
        })
    })

    test("finds PRs by head name when the branch ref was deleted", () => {
        const pulls = parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(
            JSON.stringify({
                data: {
                    repository: {
                        h0: null,
                        p0: {
                            nodes: [
                                {
                                    number: 120,
                                    headRefName: "feature-a",
                                    baseRefName: "main",
                                    state: "MERGED",
                                    merged: true,
                                    updatedAt: "2026-01-02T00:00:00Z",
                                },
                            ],
                        },
                    },
                },
            }),
        )

        expect(pulls.get("feature-a")).toEqual({
            number: 120,
            headRefName: "feature-a",
            baseRefName: "main",
            state: "MERGED",
            merged: true,
            updatedAt: "2026-01-02T00:00:00Z",
        })
    })

    test("skips missing refs and malformed entries", () => {
        const pulls = parseGhPullRequestsByHeadGraphqlJson(
            JSON.stringify({
                data: {
                    repository: {
                        h0: null,
                        h1: {
                            associatedPullRequests: {
                                nodes: [
                                    { number: 123, headRefName: "feature-a" },
                                    { number: "bad", headRefName: "feature-b" },
                                    { number: 124 },
                                    null,
                                ],
                            },
                        },
                    },
                },
            }),
        )

        expect([...pulls.values()]).toEqual([
            { number: 123, headRefName: "feature-a" },
        ])
    })
})
