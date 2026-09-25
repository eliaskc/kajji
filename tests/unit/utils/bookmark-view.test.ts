import { describe, expect, test } from "bun:test"
import { nextBookmarkView } from "../../../src/utils/bookmark-view"

describe("nextBookmarkView", () => {
    test("cycles local, remote only, deleted only", () => {
        expect(nextBookmarkView("local")).toBe("remote")
        expect(nextBookmarkView("remote")).toBe("deleted")
        expect(nextBookmarkView("deleted")).toBe("local")
    })
})
