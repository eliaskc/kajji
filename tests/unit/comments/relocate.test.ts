import { describe, expect, test } from "bun:test"
import { relocateRevision } from "../../../src/comments/relocate"
import type { RevisionComments } from "../../../src/comments/types"
import { parseDiffString } from "../../../src/diff/parser"

describe("relocateRevision", () => {
    test("relocates line anchors using context match", () => {
        const diff = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2 changed
 line3
+line4
`
        const files = parseDiffString(diff)
        const revision: RevisionComments = {
            commitHash: "oldhash",
            anchors: [
                {
                    id: "l_1",
                    type: "line",
                    filePath: "a.txt",
                    lineNumber: 2,
                    contextLines: ["line1", "line3"],
                    comments: [],
                },
            ],
        }

        const result = relocateRevision(revision, files)

        const anchor = result.updated.anchors[0]
        expect(anchor?.type).toBe("line")
        if (anchor?.type === "line") {
            expect(anchor.stale).toBe(false)
            expect(anchor.lineNumber).toBe(2)
            expect(anchor.contextLines).toContain("line1")
        }
    })
})
