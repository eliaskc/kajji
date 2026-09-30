import { describe, expect, test } from "bun:test"
import type { FileId, HunkId } from "../../../src/diff/identifiers"
import type { FlattenedFile } from "../../../src/diff/parser"
import {
    BINARY_PREVIEW_HEIGHT,
    buildDiffLayoutIndex,
    buildHunkNavigationIndex,
    findDiffScrollAnchorRowIndex,
    flattenToRows,
    getAdjacentHunkFromRow,
    getCurrentDiffPosition,
    getCurrentDiffScrollAnchor,
    getCurrentFileId,
    getFileScrollTailHeight,
    shouldShowStickyFileHeader,
} from "../../../src/diff/virtualization"

interface TestRow {
    row: {
        fileId: FileId
        type?: string
        hunkId?: HunkId | null
        newLine?: number
        oldLine?: number
    }
}

function indexRows(rows: readonly TestRow[]) {
    return buildDiffLayoutIndex(
        rows,
        ({ row }) => row.newLine,
        ({ row }) => row.oldLine,
    )
}

describe("flattenToRows", () => {
    test("keeps binary previews in file order", () => {
        const file = (fileId: FileId, name: string, isBinary = false): FlattenedFile => ({
            fileId,
            name,
            type: "change",
            hunks: [],
            additions: 0,
            deletions: 0,
            isBinary,
        })
        const files = [
            file("first" as FileId, "a.txt"),
            file("binary" as FileId, "b.png", true),
            file("last" as FileId, "c.txt"),
        ]

        const rows = flattenToRows(files)
        const binaryHeader = rows.findIndex(
            (row) => row.fileId === "binary" && row.type === "file-header",
        )
        const lastHeader = rows.findIndex(
            (row) => row.fileId === "last" && row.type === "file-header",
        )

        expect(binaryHeader).toBeGreaterThan(0)
        expect(lastHeader).toBe(binaryHeader + BINARY_PREVIEW_HEIGHT + 2)
        expect(rows.filter((row) => row.type === "binary-preview")).toHaveLength(1)
        expect(rows.filter((row) => row.type === "binary-preview-reserved-row")).toHaveLength(
            BINARY_PREVIEW_HEIGHT - 1,
        )
    })
})

describe("layout hunk offsets", () => {
    test("returns the first visual row for each hunk", () => {
        const first: HunkId = "first"
        const second: HunkId = "second"
        const offsets = indexRows([
            { row: { fileId: "file", hunkId: null } },
            { row: { fileId: "file", hunkId: first } },
            { row: { fileId: "file", hunkId: first } },
            { row: { fileId: "file", hunkId: null } },
            { row: { fileId: "file", hunkId: second } },
        ]).hunkOffsets

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
        const offsets = indexRows([
            { row: { fileId: "file", hunkId: first } },
            { row: { fileId: "file", hunkId: first } },
            { row: { fileId: "file", hunkId: first } },
            { row: { fileId: "file", hunkId: second } },
        ]).hunkOffsets

        expect(offsets.get(second)).toBe(3)
    })
})

describe("layout file offsets", () => {
    test("returns each file header's visual row", () => {
        const first = "first" as FileId
        const second = "second" as FileId
        expect(
            indexRows([
                { row: { fileId: first, type: "file-header" } },
                { row: { fileId: first, type: "content" } },
                { row: { fileId: second, type: "file-header" } },
            ]).fileOffsets,
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
        expect(getFileScrollTailHeight(indexRows(rows), 10, 6)).toBe(7)
    })

    test("adds no space when the last file already fills the viewport", () => {
        expect(getFileScrollTailHeight(indexRows(rows), 3)).toBe(0)
    })

    test("adds no space when all files fit without scrolling", () => {
        expect(getFileScrollTailHeight(indexRows(rows), 10)).toBe(0)
    })

    test("adds no space for a single file", () => {
        expect(getFileScrollTailHeight(indexRows(rows.slice(2)), 3, 10)).toBe(0)
    })
})

describe("getCurrentDiffPosition", () => {
    const first = "first" as FileId
    const second = "second" as FileId
    const rows = [
        { row: { fileId: first } },
        { row: { fileId: first, oldLine: 10 } },
        { row: { fileId: first, newLine: 11 } },
        { row: { fileId: second, newLine: 80 } },
    ]
    const position = (scrollTop: number) => getCurrentDiffPosition(indexRows(rows), scrollTop)

    test("uses the top row's file and nearest new-side line", () => {
        expect(position(0)).toEqual({ fileId: first, lineNumber: 11 })
        expect(position(1)).toEqual({ fileId: first, lineNumber: 11 })
        expect(position(3)).toEqual({ fileId: second, lineNumber: 80 })
    })

    test("keeps the top-row file when the viewport center crosses a boundary", () => {
        expect(getCurrentDiffPosition(indexRows(rows), 0, 3)).toEqual({
            fileId: first,
            lineNumber: 11,
        })
    })

    test("falls back to an old-side line when no new-side line exists", () => {
        expect(getCurrentDiffPosition(indexRows(rows.slice(0, 2)), 0)).toEqual({
            fileId: first,
            lineNumber: 10,
        })
    })
})

describe("semantic diff scroll anchors", () => {
    const first = "first" as FileId
    const rows = [
        { row: { fileId: first } },
        { row: { fileId: first, oldLine: 10 } },
        { row: { fileId: first, newLine: 11 } },
    ]
    test("records the source line's offset within the viewport", () => {
        expect(getCurrentDiffScrollAnchor(indexRows(rows), 1, 2)).toEqual({
            fileId: first,
            newLineNumber: 11,
            oldLineNumber: undefined,
            viewportOffset: 1,
        })
    })

    test("finds the same source line after visual rows reflow", () => {
        const firstRow = rows[0]
        if (!firstRow) throw new Error("expected fixture row")
        const reflowedRows = [firstRow, firstRow, ...rows.slice(1)]
        expect(
            findDiffScrollAnchorRowIndex(indexRows(reflowedRows), {
                fileId: first,
                newLineNumber: 11,
                viewportOffset: 1,
            }),
        ).toBe(3)
    })
})

describe("sticky file header", () => {
    const file = (fileId: string, lines: number): FlattenedFile => ({
        fileId: fileId as FileId,
        name: `${fileId}.txt`,
        type: "change",
        additions: lines,
        deletions: 0,
        hunks: [
            {
                hunkId: `${fileId}:1` as HunkId,
                oldStart: 1,
                oldLines: 0,
                newStart: 1,
                newLines: lines,
                lines: Array.from({ length: lines }, (_, index) => ({
                    type: "addition" as const,
                    content: `${fileId} ${index}`,
                    hunkId: `${fileId}:1` as HunkId,
                    newLineNumber: index + 1,
                })),
            },
        ],
    })
    const rows = flattenToRows([file("a", 3), file("b", 2), file("c", 4)]).map((row) => ({
        row,
    }))

    test("stays hidden when the view is not scrolled", () => {
        // Also covers diffs that fit the viewport and cannot scroll.
        expect(shouldShowStickyFileHeader(0, 0)).toBe(false)
    })

    for (const leadingHeight of [0, 1, 6]) {
        test(`never duplicates or hides an inline header (leading height ${leadingHeight})`, () => {
            for (let scrollTop = 1; scrollTop < leadingHeight + rows.length; scrollTop++) {
                const contentTop = scrollTop - leadingHeight
                const visible = shouldShowStickyFileHeader(scrollTop, leadingHeight)
                // Show as soon as diff content reaches the top, and never earlier.
                expect(visible).toBe(contentTop >= 0)
                if (!visible) continue
                const sticky = getCurrentFileId(rows, contentTop)
                const covered = rows[contentTop]?.row
                const below = rows[contentTop + 1]?.row
                // The sticky header covers row 0. It may cover only its own inline header.
                if (covered?.type === "file-header") expect(covered.fileId).toBe(sticky!)
                if (below?.type === "file-header") expect(below.fileId).not.toBe(sticky!)
            }
        })
    }
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

describe("indexed hunk navigation", () => {
    const first: HunkId = "first"
    const second: HunkId = "second"
    const third: HunkId = "third"
    const files = [
        { hunks: [{ hunkId: first }, { hunkId: second }] },
        { hunks: [] },
        { hunks: [{ hunkId: third }] },
    ]

    const navigation = buildHunkNavigationIndex(
        files,
        new Map([
            [first, 0],
            [second, 5],
            [third, 10],
        ]),
    )

    test("navigates within a file", () => {
        expect(getAdjacentHunkFromRow(navigation, 0, 1)).toMatchObject({
            fileIndex: 0,
            hunkIndex: 1,
            hunkId: second,
        })
    })

    test("crosses files and skips files without hunks", () => {
        expect(getAdjacentHunkFromRow(navigation, 5, 1)).toMatchObject({
            fileIndex: 2,
            hunkIndex: 0,
            hunkId: third,
        })
        expect(getAdjacentHunkFromRow(navigation, 10, -1)).toMatchObject({
            fileIndex: 0,
            hunkIndex: 1,
            hunkId: second,
        })
    })

    test("stops at the first and last hunk", () => {
        expect(getAdjacentHunkFromRow(navigation, 0, -1)).toBeUndefined()
        expect(getAdjacentHunkFromRow(navigation, 10, 1)).toBeUndefined()
    })
})

describe("getAdjacentHunkFromRow", () => {
    const files = [
        { hunks: [{ hunkId: "a:1" }, { hunkId: "a:2" }] },
        { hunks: [] },
        { hunks: [{ hunkId: "c:1" }] },
    ]
    const offsets = new Map([
        ["a:1", 3],
        ["a:2", 10],
        ["c:1", 20],
    ])

    const navigation = buildHunkNavigationIndex(files, offsets)

    test("navigates relative to the visible row", () => {
        expect(getAdjacentHunkFromRow(navigation, 7, 1)?.hunkId).toBe("a:2")
        expect(getAdjacentHunkFromRow(navigation, 7, -1)?.hunkId).toBe("a:1")
    })

    test("crosses files without relying on stale indexes", () => {
        expect(getAdjacentHunkFromRow(navigation, 10, 1)?.hunkId).toBe("c:1")
        expect(getAdjacentHunkFromRow(navigation, 20, -1)?.hunkId).toBe("a:2")
    })

    test("advances from the last navigation target when scrolling clamps", () => {
        const extendedFiles = [...files, { hunks: [{ hunkId: "d:1" }] }]
        const extendedOffsets = new Map(offsets).set("d:1", 25)
        const extendedNavigation = buildHunkNavigationIndex(extendedFiles, extendedOffsets)
        const first = getAdjacentHunkFromRow(extendedNavigation, 15, 1)
        expect(first?.hunkId).toBe("c:1")
        expect(
            getAdjacentHunkFromRow(
                extendedNavigation,
                extendedOffsets.get(first?.hunkId ?? "") ?? 15,
                1,
            )?.hunkId,
        ).toBe("d:1")
    })
})
