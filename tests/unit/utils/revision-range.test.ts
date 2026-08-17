import { describe, expect, test } from "bun:test"
import type { Commit } from "../../../src/commander/types"
import { connectedRevisionRange } from "../../../src/utils/revision-range"

const commit = (id: string, parents: string[]): Commit =>
    ({
        changeId: `change-${id}`,
        commitId: id,
        parentCommitIds: parents,
    }) as Commit

const ids = (commits: Commit[]) => commits.map((c) => c.commitId)

// Linear history, newest first: a -> b -> c -> d
const linear = [commit("a", ["b"]), commit("b", ["c"]), commit("c", ["d"]), commit("d", ["e"])]

// Sibling branch interleaved in log order, like a second workspace's
// working copy: a and side are both children of b.
//   a    -> b -> c
//   side -> b
const withSibling = [
    commit("a", ["b"]),
    commit("side", ["b"]),
    commit("b", ["c"]),
    commit("c", ["d"]),
]

// Merge commit: m has parents p1 and p2, both eventually reaching base.
const withMerge = [
    commit("m", ["p1", "p2"]),
    commit("p1", ["base"]),
    commit("p2", ["base"]),
    commit("base", ["root"]),
]

// Elided revisions: b's parent "hidden" is not in the loaded log; c is the
// next loaded commit below the elision marker.
const withElision = [commit("a", ["b"]), commit("b", ["hidden"]), commit("c", ["d"])]

describe("connectedRevisionRange", () => {
    test("returns the single commit when anchor and cursor match", () => {
        const range = connectedRevisionRange(linear, 1, 1)
        expect(ids(range.chain)).toEqual(["b"])
        expect(range.connected).toBe(true)
    })

    test("returns the full chain for a contiguous linear range", () => {
        const range = connectedRevisionRange(linear, 0, 2)
        expect(ids(range.chain)).toEqual(["a", "b", "c"])
        expect(range.connected).toBe(true)
    })

    test("normalizes anchor and cursor order", () => {
        expect(ids(connectedRevisionRange(linear, 2, 0).chain)).toEqual(["a", "b", "c"])
    })

    test("skips interleaved sibling branches", () => {
        const range = connectedRevisionRange(withSibling, 0, 2)
        expect(ids(range.chain)).toEqual(["a", "b"])
        expect(range.connected).toBe(true)
    })

    test("keeps the chain when anchored below the sibling", () => {
        expect(ids(connectedRevisionRange(withSibling, 0, 3).chain)).toEqual(["a", "b", "c"])
    })

    test("reports endpoints as disconnected for sibling heads", () => {
        // a and side are siblings; neither is an ancestor of the other.
        const range = connectedRevisionRange(withSibling, 0, 1)
        expect(ids(range.chain)).toEqual(["a", "side"])
        expect(range.connected).toBe(false)
    })

    test("estimates partial segments across elided revisions", () => {
        // The endpoints are not connected locally, but rows hanging off
        // either endpoint highlight immediately: b is an ancestor of a even
        // though the path continues through hidden revisions.
        const range = connectedRevisionRange(withElision, 0, 2)
        expect(ids(range.chain)).toEqual(["a", "b", "c"])
        expect(range.connected).toBe(false)
    })

    test("excludes siblings from the disconnected estimate", () => {
        // side branches off c and is not reachable from a nor reaches d.
        const commits = [
            commit("a", ["hidden"]),
            commit("side", ["c"]),
            commit("c", ["hidden2"]),
            commit("d", ["e"]),
        ]
        const range = connectedRevisionRange(commits, 0, 3)
        expect(ids(range.chain)).toEqual(["a", "d"])
        expect(range.connected).toBe(false)
    })

    test("includes both sides of a merge", () => {
        const range = connectedRevisionRange(withMerge, 0, 3)
        expect(ids(range.chain)).toEqual(["m", "p1", "p2", "base"])
        expect(range.connected).toBe(true)
    })

    test("clamps out-of-range indices", () => {
        expect(ids(connectedRevisionRange(linear, -5, 99).chain)).toEqual(["a", "b", "c", "d"])
    })

    test("returns empty for an empty log", () => {
        expect(connectedRevisionRange([], 0, 0).chain).toEqual([])
    })
})
