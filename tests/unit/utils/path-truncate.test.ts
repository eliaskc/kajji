import { describe, expect, test } from "bun:test"
import { splitDisplayPath } from "../../../src/utils/path-truncate"

describe("splitDisplayPath", () => {
    test("separates a directory from its file name", () => {
        expect(splitDisplayPath("src/components/App.tsx")).toEqual({
            directory: "src/components/",
            fileName: "App.tsx",
            suffix: "",
        })
    })

    test("keeps a renamed path suffix separate from the current file name", () => {
        expect(
            splitDisplayPath(
                "src/components/NewName.tsx ← old/components/OldName.tsx",
            ),
        ).toEqual({
            directory: "src/components/",
            fileName: "NewName.tsx",
            suffix: " ← old/components/OldName.tsx",
        })
    })
})
