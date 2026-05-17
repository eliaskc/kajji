import { describe, expect, test } from "bun:test"
import { parseBookmarkOutput } from "../../../src/commander/bookmarks"

describe("parseBookmarkOutput", () => {
    test("parses local bookmark", () => {
        const output =
            "__BJ__main__BJ__\x1b[38;5;5mmain\x1b[39m__BJ____BJ__cshort__BJ__kshort__BJ__changefull__BJ__commitfull__BJ__feat: add feature"
        const result = parseBookmarkOutput(output)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
            name: "main",
            nameDisplay: "\x1b[38;5;5mmain\x1b[39m",
            changeId: "changefull",
            commitId: "commitfull",
            changeIdDisplay: "cshort",
            commitIdDisplay: "kshort",
            descriptionDisplay: "feat: add feature",
            description: "feat: add feature",
            isLocal: true,
        })
    })

    test("parses remote bookmark", () => {
        const output =
            "__BJ__main__BJ__\x1b[38;5;5mmain\x1b[39m__BJ__origin__BJ__cshort__BJ__kshort__BJ__changefull__BJ__commitfull__BJ__feat: add feature"
        const result = parseBookmarkOutput(output)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
            name: "main",
            nameDisplay: "\x1b[38;5;5mmain\x1b[39m",
            changeId: "changefull",
            commitId: "commitfull",
            changeIdDisplay: "cshort",
            commitIdDisplay: "kshort",
            descriptionDisplay: "feat: add feature",
            description: "feat: add feature",
            isLocal: false,
            remote: "origin",
        })
    })

    test("parses local with remote bookmarks", () => {
        const output = `__BJ__main__BJ__main__BJ____BJ__c1__BJ__k1__BJ__cfull1__BJ__kfull1__BJ__feat: add feature
__BJ__main__BJ__main__BJ__git__BJ__c2__BJ__k2__BJ__cfull2__BJ__kfull2__BJ__feat: add feature
__BJ__main__BJ__main__BJ__origin__BJ__c3__BJ__k3__BJ__cfull3__BJ__kfull3__BJ__feat: add feature`
        const result = parseBookmarkOutput(output)

        expect(result).toHaveLength(3)
        expect(result[0]?.isLocal).toBe(true)
        expect(result[0]?.name).toBe("main")
        expect(result[1]?.isLocal).toBe(false)
        expect(result[1]?.remote).toBe("git")
        expect(result[2]?.isLocal).toBe(false)
        expect(result[2]?.remote).toBe("origin")
    })

    test("parses multiple local bookmarks", () => {
        const output = `__BJ__main__BJ__main__BJ____BJ__c1__BJ__k1__BJ__cfull1__BJ__kfull1__BJ__main branch
__BJ__feature/foo__BJ__feature/foo__BJ____BJ__c2__BJ__k2__BJ__cfull2__BJ__kfull2__BJ__working on foo
__BJ__bugfix__BJ__bugfix__BJ____BJ__c3__BJ__k3__BJ__cfull3__BJ__kfull3__BJ__fix something`
        const result = parseBookmarkOutput(output)

        expect(result).toHaveLength(3)
        expect(result[0]?.name).toBe("main")
        expect(result[1]?.name).toBe("feature/foo")
        expect(result[2]?.name).toBe("bugfix")
    })

    test("handles empty description", () => {
        const output =
            "__BJ__main__BJ__main__BJ____BJ__cshort__BJ__kshort__BJ__changefull__BJ__commitfull__BJ__(no description set)"
        const result = parseBookmarkOutput(output)

        expect(result).toHaveLength(1)
        expect(result[0]?.description).toBe("(no description set)")
    })

    test("handles empty output", () => {
        const result = parseBookmarkOutput("")
        expect(result).toHaveLength(0)
    })

    test("handles output with blank lines", () => {
        const output = `__BJ__main__BJ__main__BJ____BJ__c1__BJ__k1__BJ__cfull1__BJ__kfull1__BJ__feature

__BJ__other__BJ__other__BJ____BJ__c2__BJ__k2__BJ__cfull2__BJ__kfull2__BJ__other branch`
        const result = parseBookmarkOutput(output)

        expect(result).toHaveLength(2)
    })

    test("parses bookmark with special characters in name", () => {
        const output =
            "__BJ__feature/my-branch__BJ__feature/my-branch__BJ____BJ__cshort__BJ__kshort__BJ__changefull__BJ__commitfull__BJ__description"
        const result = parseBookmarkOutput(output)

        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe("feature/my-branch")
    })
})
