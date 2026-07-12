import { describe, expect, test } from "bun:test"
import type { HunkId } from "../../../src/diff/identifiers"
import {
    getAdjacentHunk,
    getHunkRowOffsets,
} from "../../../src/diff/virtualization"

describe("getHunkRowOffsets", () => {
    test("returns the first visual row for each hunk", () => {
        const first: HunkId = "first"
        const second: HunkId = "second"
        const offsets = getHunkRowOffsets([
            { row: { hunkId: null } },
            { row: { hunkId: first } },
            { row: { hunkId: first } },
            { row: { hunkId: null } },
            { row: { hunkId: second } },
        ])

        expect(offsets).toEqual(
            new Map([
                [first, 1],
                [second, 4],
            ]),
        )
    })

    test("counts wrapped rows before later hunks", () => {
        const first: HunkId = "first"
        const second: HunkId = "second"
        const offsets = getHunkRowOffsets([
            { row: { hunkId: first } },
            { row: { hunkId: first } },
            { row: { hunkId: first } },
            { row: { hunkId: second } },
        ])

        expect(offsets.get(second)).toBe(3)
    })
})

describe("getAdjacentHunk", () => {
    const first: HunkId = "first"
    const second: HunkId = "second"
    const third: HunkId = "third"
    const files = [
        { hunks: [{ hunkId: first }, { hunkId: second }] },
        { hunks: [] },
        { hunks: [{ hunkId: third }] },
    ]

    test("navigates within a file", () => {
        expect(getAdjacentHunk(files, 0, 0, 1)).toEqual({
            fileIndex: 0,
            hunkIndex: 1,
            hunkId: second,
        })
    })

    test("crosses files and skips files without hunks", () => {
        expect(getAdjacentHunk(files, 0, 1, 1)).toEqual({
            fileIndex: 2,
            hunkIndex: 0,
            hunkId: third,
        })
        expect(getAdjacentHunk(files, 2, 0, -1)).toEqual({
            fileIndex: 0,
            hunkIndex: 1,
            hunkId: second,
        })
    })

    test("stops at the first and last hunk", () => {
        expect(getAdjacentHunk(files, 0, 0, -1)).toBeUndefined()
        expect(getAdjacentHunk(files, 2, 0, 1)).toBeUndefined()
    })
})
