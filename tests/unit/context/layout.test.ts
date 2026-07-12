import { describe, expect, test } from "bun:test"
import { getFilesLayoutWeights } from "../../../src/utils/layout"

describe("getFilesLayoutWeights", () => {
    test.each([
        [140, { files: 1, detail: 4 }],
        [139, { files: 3, detail: 7 }],
        [100, { files: 3, detail: 7 }],
        [99, { files: 2, detail: 3 }],
        [80, { files: 2, detail: 3 }],
        [79, { files: 1, detail: 1 }],
    ])("uses responsive weights at width %i", (width, expected) => {
        expect(getFilesLayoutWeights(width)).toEqual(expected)
    })
})
