import { describe, expect, it } from "bun:test"
import { parseFileSummary } from "../../../src/commander/files"

describe("parseFileSummary", () => {
    it("parses added file", () => {
        const output = "A src/new-file.ts"
        const result = parseFileSummary(output)
        expect(result).toEqual([{ path: "src/new-file.ts", status: "added" }])
    })

    it("parses modified file", () => {
        const output = "M src/existing.ts"
        const result = parseFileSummary(output)
        expect(result).toEqual([
            { path: "src/existing.ts", status: "modified" },
        ])
    })

    it("parses deleted file", () => {
        const output = "D old-file.ts"
        const result = parseFileSummary(output)
        expect(result).toEqual([{ path: "old-file.ts", status: "deleted" }])
    })

    it("parses renamed file with simple format", () => {
        const output = "R old.ts => new.ts"
        const result = parseFileSummary(output)
        expect(result).toEqual([
            { path: "new.ts", status: "renamed", oldPath: "old.ts" },
        ])
    })

    it("parses renamed file with braced format", () => {
        const output = "R {old => new}.ts"
        const result = parseFileSummary(output)
        expect(result).toEqual([
            { path: "new.ts", status: "renamed", oldPath: "old.ts" },
        ])
    })

    it("parses renamed file with path and braced format", () => {
        const output = "R src/{old-name => new-name}.ts"
        const result = parseFileSummary(output)
        expect(result).toEqual([
            {
                path: "src/new-name.ts",
                status: "renamed",
                oldPath: "src/old-name.ts",
            },
        ])
    })

    it("parses copied file", () => {
        const output = "C src/original.ts => src/copy.ts"
        const result = parseFileSummary(output)
        expect(result).toEqual([
            {
                path: "src/copy.ts",
                status: "copied",
                oldPath: "src/original.ts",
            },
        ])
    })

    it("parses multiple files", () => {
        const output = `A src/new.ts
M src/modified.ts
D src/deleted.ts`
        const result = parseFileSummary(output)
        expect(result).toEqual([
            { path: "src/new.ts", status: "added" },
            { path: "src/modified.ts", status: "modified" },
            { path: "src/deleted.ts", status: "deleted" },
        ])
    })

    it("handles empty output", () => {
        const result = parseFileSummary("")
        expect(result).toEqual([])
    })

    it("handles output with blank lines", () => {
        const output = `A src/a.ts

M src/b.ts
`
        const result = parseFileSummary(output)
        expect(result).toEqual([
            { path: "src/a.ts", status: "added" },
            { path: "src/b.ts", status: "modified" },
        ])
    })

    it("skips lines with unknown status", () => {
        const output = `A src/a.ts
X unknown/format.ts
M src/b.ts`
        const result = parseFileSummary(output)
        expect(result).toEqual([
            { path: "src/a.ts", status: "added" },
            { path: "src/b.ts", status: "modified" },
        ])
    })
})
