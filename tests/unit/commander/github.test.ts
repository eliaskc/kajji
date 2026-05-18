import { describe, expect, test } from "bun:test"
import {
    parseGhPullRequestsByHeadGraphqlJson,
    parseGhPullRequestsByHeadGraphqlJsonIncludingClosed,
    parseGhRepositoryJson,
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
