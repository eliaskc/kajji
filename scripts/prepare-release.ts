/**
 * Deterministic release preparation. Run from the repository root.
 *
 *   bun run scripts/prepare-release.ts context --bump auto --output context.json
 *   bun run scripts/prepare-release.ts apply --context context.json --proposal proposal.json --body body.md
 *
 * `context` collects the commits since the latest release tag. An agent reads the
 * context and writes a JSON proposal (`{ version, notes }`). `apply` validates
 * the proposal and is the only step that writes `package.json` and `CHANGELOG.md`.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"

export const BUMPS = ["auto", "patch", "minor", "major"] as const
export type Bump = (typeof BUMPS)[number]

export const SECTIONS = ["breaking", "new", "improved", "fixed"] as const

const CHANGELOG_HEADING = "# Changelog\n"
const MAX_NOTES_LENGTH = 30_000
const MAX_FILES_PER_COMMIT = 50

export interface ReleaseCommit {
    sha: string
    subject: string
    body: string
    files: string[]
}

export interface ReleaseContext {
    version: string
    bump: Bump
    previousTag: string
    sha: string
    commits: ReleaseCommit[]
}

export interface ReleaseProposal {
    version: string
    notes: string
}

const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }).trim()

export function parseVersion(value: unknown): [number, number, number] {
    if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
        throw new Error(`Expected a stable x.y.z version, got ${JSON.stringify(value)}`)
    }
    const [major = 0, minor = 0, patch = 0] = value.split(".").map(Number)
    return [major, minor, patch]
}

export function bumpVersion(current: string, kind: Exclude<Bump, "auto">): string {
    const [major, minor, patch] = parseVersion(current)
    switch (kind) {
        case "major":
            return `${major + 1}.0.0`
        case "minor":
            return `${major}.${minor + 1}.0`
        case "patch":
            return `${major}.${minor}.${patch + 1}`
    }
}

export function compareVersions(a: string, b: string): number {
    const [leftMajor, leftMinor, leftPatch] = parseVersion(a)
    const [rightMajor, rightMinor, rightPatch] = parseVersion(b)
    return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch
}

/** In `auto` mode a 0.x release never leaves 0.x; breaking changes bump minor. */
export function allowedVersions(context: Pick<ReleaseContext, "version" | "bump">): string[] {
    const preOne = parseVersion(context.version)[0] === 0
    const kinds =
        context.bump !== "auto"
            ? [context.bump]
            : preOne
              ? (["patch", "minor"] as const)
              : (["patch", "minor", "major"] as const)
    return kinds.map((kind) => bumpVersion(context.version, kind))
}

/** Parse `git log --format=%x1e%H%x1f%s%x1f%b%x1f --name-only` output. */
export function parseCommitLog(output: string): ReleaseCommit[] {
    return output
        .split("\x1e")
        .filter((record) => record.trim())
        .map((record) => {
            const [sha = "", subject = "", body = "", fileList = ""] = record.split("\x1f")
            const files = fileList
                .split("\n")
                .map((file) => file.trim())
                .filter(Boolean)
            if (files.length > MAX_FILES_PER_COMMIT) {
                const hidden = files.length - MAX_FILES_PER_COMMIT
                files.splice(MAX_FILES_PER_COMMIT, hidden, `... ${hidden} more files`)
            }
            return { sha: sha.trim(), subject: subject.trim(), body: body.trim(), files }
        })
}

function latestReleaseTag(): string | undefined {
    const tags = git("tag", "--merged", "HEAD", "--list", "v*")
        .split("\n")
        .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    return tags.sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0]
}

function readPackageVersion(): string {
    const version = JSON.parse(readFileSync("package.json", "utf-8")).version
    parseVersion(version)
    return version
}

export function createContext(bump: Bump): ReleaseContext {
    if (!BUMPS.includes(bump)) throw new Error(`Unknown bump: ${bump}`)
    const version = readPackageVersion()
    const previousTag = latestReleaseTag()
    if (!previousTag) throw new Error("No vX.Y.Z release tag is reachable from HEAD")
    if (previousTag !== `v${version}`) {
        throw new Error(
            `package.json version ${version} does not match the latest tag ${previousTag}. Finish the pending release before preparing another.`,
        )
    }
    const commits = parseCommitLog(
        git(
            "log",
            `${previousTag}..HEAD`,
            "--no-merges",
            "--format=%x1e%H%x1f%s%x1f%b%x1f",
            "--name-only",
        ),
    )
    if (commits.length === 0) throw new Error(`No changes since ${previousTag}`)
    return { version, bump, previousTag, sha: git("rev-parse", "HEAD"), commits }
}

/** Accept raw JSON, optionally wrapped in one Markdown code fence. */
export function parseProposal(text: string): unknown {
    const trimmed = text.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/)
    return JSON.parse(fenced?.[1] ?? trimmed)
}

export function validateProposal(proposal: unknown, context: ReleaseContext): ReleaseProposal {
    if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) {
        throw new Error("Proposal must be a JSON object")
    }
    const keys = Object.keys(proposal).sort()
    if (keys.join(",") !== "notes,version") {
        throw new Error(`Proposal must contain only version and notes, got: ${keys.join(", ")}`)
    }
    const { version, notes } = proposal as Record<string, unknown>
    parseVersion(version)
    const allowed = allowedVersions(context)
    if (!allowed.includes(version as string)) {
        throw new Error(`Version must be one of ${allowed.join(", ")}, got ${version}`)
    }
    if (typeof notes !== "string" || !notes.trim() || notes.length > MAX_NOTES_LENGTH) {
        throw new Error(`Notes must be nonempty and at most ${MAX_NOTES_LENGTH} characters`)
    }
    if (notes.includes("\0")) throw new Error("Notes must not contain NUL characters")

    const lines = notes.trim().split("\n")
    const headings: string[] = []
    for (const line of lines) {
        if (/^#{1,2}\s/.test(line) || /^#{4,}\s/.test(line)) {
            throw new Error(`Notes must use only level-three headings: ${line}`)
        }
        const heading = line.match(/^###\s+(.*)$/)
        if (heading?.[1]) headings.push(heading[1].trim())
    }
    if (headings.length === 0) throw new Error("Notes must contain at least one section")
    let previous = -1
    for (const heading of headings) {
        const index = SECTIONS.indexOf(heading as (typeof SECTIONS)[number])
        if (index === -1) {
            throw new Error(`Unknown section "${heading}". Use: ${SECTIONS.join(", ")}`)
        }
        if (index <= previous)
            throw new Error(`Sections must be unique and in order: ${SECTIONS.join(", ")}`)
        previous = index
    }

    for (const [, hash = ""] of notes.matchAll(/\.\.\/\.\.\/commit\/([0-9a-f]+)/g)) {
        if (hash.length < 7 || !context.commits.some((commit) => commit.sha.startsWith(hash))) {
            throw new Error(`Notes reference a commit outside the release range: ${hash}`)
        }
    }

    return { version: version as string, notes: notes.trim() }
}

export function prependChangelog(changelog: string, version: string, notes: string): string {
    if (!changelog.startsWith(CHANGELOG_HEADING)) throw new Error("Unexpected CHANGELOG.md heading")
    const escaped = version.replaceAll(".", "\\.")
    if (new RegExp(`^## ${escaped}$`, "m").test(changelog)) {
        throw new Error(`CHANGELOG.md already has a section for ${version}`)
    }
    const rest = changelog.slice(CHANGELOG_HEADING.length).replace(/^\n+/, "")
    return `${CHANGELOG_HEADING}\n## ${version}\n\n${notes}\n\n${rest}`
}

export function setPackageVersion(packageJson: string, version: string): string {
    let count = 0
    const updated = packageJson.replace(/^(\s*"version":\s*")[^"]+(")/m, (_, start, end) => {
        count += 1
        return `${start}${version}${end}`
    })
    if (count !== 1) throw new Error("Could not find the package.json version field")
    return updated
}

export function applyProposal(proposal: unknown, snapshot: ReleaseContext): ReleaseProposal {
    if (git("rev-parse", "HEAD") !== snapshot.sha) {
        throw new Error("HEAD differs from the commit used to prepare the release")
    }
    if (JSON.stringify(createContext(snapshot.bump)) !== JSON.stringify(snapshot)) {
        throw new Error("Release context changed. Prepare the release again.")
    }
    const accepted = validateProposal(proposal, snapshot)
    writeFileSync(
        "CHANGELOG.md",
        prependChangelog(readFileSync("CHANGELOG.md", "utf-8"), accepted.version, accepted.notes),
    )
    writeFileSync(
        "package.json",
        setPackageVersion(readFileSync("package.json", "utf-8"), accepted.version),
    )
    return accepted
}

if (import.meta.main) {
    const [command, ...rest] = process.argv.slice(2)
    const { values } = parseArgs({
        args: rest,
        options: {
            bump: { type: "string", default: "auto" },
            output: { type: "string" },
            context: { type: "string" },
            proposal: { type: "string" },
            body: { type: "string" },
        },
    })
    try {
        if (command === "context") {
            if (!values.output) throw new Error("--output is required")
            const context = createContext(values.bump as Bump)
            writeFileSync(values.output, `${JSON.stringify(context, null, 2)}\n`)
        } else if (command === "apply") {
            if (!values.context || !values.proposal || !values.body) {
                throw new Error("--context, --proposal, and --body are required")
            }
            const snapshot = JSON.parse(readFileSync(values.context, "utf-8")) as ReleaseContext
            const proposal = parseProposal(readFileSync(values.proposal, "utf-8"))
            const { version, notes } = applyProposal(proposal, snapshot)
            writeFileSync(
                values.body,
                `## kajji v${version}\n\n${notes}\n\n---\n\nReview the version and notes before merging. Merging this PR publishes the release.\n`,
            )
            console.log(version)
        } else {
            throw new Error("Usage: prepare-release.ts <context|apply> [options]")
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    }
}
