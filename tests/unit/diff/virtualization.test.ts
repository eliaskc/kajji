import { describe, expect, test } from "bun:test"
import type { FileId, HunkId } from "../../../src/diff/identifiers"
import {
    getAdjacentHunk,
    getCurrentFileId,
    getFileRowOffsets,
    getFileScrollTailHeight,
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

describe("getFileRowOffsets", () => {
    test("returns each file header's visual row", () => {
        const first = "first" as FileId
        const second = "second" as FileId
        expect(
            getFileRowOffsets([
                { row: { fileId: first, type: "file-header" } },
                { row: { fileId: first, type: "content" } },
                { row: { fileId: second, type: "file-header" } },
            ]),
        ).toEqual(
            new Map([
                [first, 0],
                [second, 2],
            ]),
        )
    })
})

describe("getFileScrollTailHeight", () => {
    const first = "first" as FileId
    const second = "second" as FileId
    const rows = [
        { row: { fileId: first, type: "file-header" } },
        { row: { fileId: first, type: "content" } },
        { row: { fileId: second, type: "file-header" } },
        { row: { fileId: second, type: "content" } },
        { row: { fileId: second, type: "content" } },
    ]

    test("adds only enough space for a short last file header to reach the top", () => {
        expect(getFileScrollTailHeight(rows, 10, 6)).toBe(7)
    })

    test("adds no space when the last file already fills the viewport", () => {
        expect(getFileScrollTailHeight(rows, 3)).toBe(0)
    })

    test("adds no space when all files fit without scrolling", () => {
        expect(getFileScrollTailHeight(rows, 10)).toBe(0)
    })

    test("adds no space for a single file", () => {
        expect(getFileScrollTailHeight(rows.slice(2), 3, 10)).toBe(0)
    })
})

describe("getCurrentFileId", () => {
    const rows = [
        { row: { fileId: "first" as FileId } },
        { row: { fileId: "first" as FileId } },
        { row: { fileId: "second" as FileId } },
    ]

    test("returns the file owning the row at the top of the viewport", () => {
        expect(getCurrentFileId(rows, 0)).toBe("first")
        expect(getCurrentFileId(rows, 1.9)).toBe("first")
        expect(getCurrentFileId(rows, 2)).toBe("second")
    })

    test("clamps offsets and handles empty rows", () => {
        expect(getCurrentFileId(rows, -1)).toBe("first")
        expect(getCurrentFileId(rows, 99)).toBe("second")
        expect(getCurrentFileId([], 0)).toBeNull()
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
