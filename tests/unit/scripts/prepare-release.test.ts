import { describe, expect, test } from "bun:test"
import {
    allowedVersions,
    bumpVersion,
    parseCommitLog,
    parseProposal,
    prependChangelog,
    type ReleaseContext,
    setPackageVersion,
    validateProposal,
} from "../../../scripts/prepare-release"

const context: ReleaseContext = {
    version: "0.17.1",
    bump: "auto",
    previousTag: "v0.17.1",
    sha: "f".repeat(40),
    commits: [
        {
            sha: `abc1234${"0".repeat(33)}`,
            subject: "feat: add thing",
            body: "",
            files: ["src/a.ts"],
        },
        { sha: `def5678${"0".repeat(33)}`, subject: "fix: repair thing", body: "", files: [] },
    ],
}

const notes = [
    "### new",
    "- thing ([`abc1234`](../../commit/abc1234))",
    "",
    "### fixed",
    "- thing repaired ([`def5678`](../../commit/def5678))",
].join("\n")

describe("versions", () => {
    test("bumps each component", () => {
        expect(bumpVersion("0.17.1", "patch")).toBe("0.17.2")
        expect(bumpVersion("0.17.1", "minor")).toBe("0.18.0")
        expect(bumpVersion("0.17.1", "major")).toBe("1.0.0")
    })

    test("auto allows any single bump and explicit bumps allow one version", () => {
        expect(allowedVersions({ ...context, version: "1.2.3" })).toEqual([
            "1.2.4",
            "1.3.0",
            "2.0.0",
        ])
        expect(allowedVersions({ ...context, bump: "minor" })).toEqual(["0.18.0"])
    })

    test("auto keeps 0.x releases below 1.0.0", () => {
        expect(allowedVersions(context)).toEqual(["0.17.2", "0.18.0"])
        expect(allowedVersions({ ...context, bump: "major" })).toEqual(["1.0.0"])
    })
})

describe("parseCommitLog", () => {
    test("parses subjects, bodies, and files", () => {
        const output =
            "\x1eaaa\x1ffeat: one\x1fbody line\x1f\nsrc/a.ts\nsrc/b.ts\n\x1ebbb\x1ffix: two\x1f\x1f\n"
        expect(parseCommitLog(output)).toEqual([
            {
                sha: "aaa",
                subject: "feat: one",
                body: "body line",
                files: ["src/a.ts", "src/b.ts"],
            },
            { sha: "bbb", subject: "fix: two", body: "", files: [] },
        ])
    })

    test("caps long file lists", () => {
        const files = Array.from({ length: 60 }, (_, i) => `f${i}`).join("\n")
        const commit = parseCommitLog(`\x1eaaa\x1fchore\x1f\x1f\n${files}\n`)[0]!
        expect(commit.files).toHaveLength(51)
        expect(commit.files.at(-1)).toBe("... 10 more files")
    })
})

describe("parseProposal", () => {
    test("accepts raw and fenced JSON", () => {
        expect(parseProposal('{"version":"1.0.0","notes":"x"}')).toEqual({
            version: "1.0.0",
            notes: "x",
        })
        expect(parseProposal('```json\n{"version":"1.0.0","notes":"x"}\n```\n')).toEqual({
            version: "1.0.0",
            notes: "x",
        })
    })
})

describe("validateProposal", () => {
    test("accepts a valid proposal", () => {
        expect(validateProposal({ version: "0.18.0", notes: `${notes}\n` }, context)).toEqual({
            version: "0.18.0",
            notes,
        })
    })

    test("rejects extra keys and disallowed versions", () => {
        expect(() => validateProposal({ version: "0.18.0", notes, extra: 1 }, context)).toThrow(
            "only version",
        )
        expect(() => validateProposal({ version: "0.19.0", notes }, context)).toThrow(
            "Version must be",
        )
        expect(() =>
            validateProposal({ version: "0.17.2", notes }, { ...context, bump: "minor" }),
        ).toThrow("Version must be")
    })

    test("rejects release headings, unknown sections, and wrong order", () => {
        expect(() =>
            validateProposal({ version: "0.18.0", notes: `## 0.18.0\n${notes}` }, context),
        ).toThrow("level-three")
        expect(() =>
            validateProposal({ version: "0.18.0", notes: "### New\n- x" }, context),
        ).toThrow("Unknown section")
        expect(() =>
            validateProposal({ version: "0.18.0", notes: "### fixed\n- x\n### new\n- y" }, context),
        ).toThrow("in order")
    })

    test("rejects commit links outside the release range", () => {
        const bad = "### fixed\n- x ([`1234567`](../../commit/1234567))"
        expect(() => validateProposal({ version: "0.17.2", notes: bad }, context)).toThrow(
            "outside the release range",
        )
    })
})

describe("file updates", () => {
    test("prepends a changelog section below the heading", () => {
        const updated = prependChangelog(
            "# Changelog\n\n## 0.17.1\n\n- old\n",
            "0.18.0",
            "### new\n- x",
        )
        expect(updated).toBe("# Changelog\n\n## 0.18.0\n\n### new\n- x\n\n## 0.17.1\n\n- old\n")
        expect(() => prependChangelog(updated, "0.18.0", "### new\n- x")).toThrow("already has")
    })

    test("updates only the package version field", () => {
        const pkg =
            '{\n    "name": "kajji",\n    "version": "0.17.1",\n    "dependencies": { "x": "1.0.0" }\n}\n'
        expect(setPackageVersion(pkg, "0.18.0")).toBe(pkg.replace('"0.17.1"', '"0.18.0"'))
    })
})
