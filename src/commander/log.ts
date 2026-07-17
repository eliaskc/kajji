import { isStaleWorkingCopyFailure } from "../utils/error-parser"
import { execute } from "./executor"
import type { Commit } from "./types"

const MARKER = "__LJ__"

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

function splitAnsiAtVisibleWidth(line: string, visibleWidth: number) {
    if (visibleWidth <= 0) return { gutter: "", content: line }

    let visible = 0
    let index = 0
    while (index < line.length && visible < visibleWidth) {
        if (line[index] === "\x1b" && line[index + 1] === "[") {
            index += 2
            while (index < line.length && line[index] !== "m") index += 1
            if (index < line.length) index += 1
            continue
        }
        index += 1
        visible += 1
    }

    return {
        gutter: line.slice(0, index),
        content: line.slice(index),
    }
}

function getVisibleWidth(line: string) {
    return stripAnsi(line).length
}

function createCommitDisplayLine(gutter: string, content: string) {
    return {
        gutter,
        content,
    }
}

export function buildLogTemplate(): string {
    const styledDescription = `if(empty, label("empty", "(empty) "), "") ++ if(description.first_line(), description.first_line(), label("description placeholder", "(no description set)"))`

    const prefix = [
        `"${MARKER}"`,
        "change_id",
        `"${MARKER}"`,
        "commit_id",
        `"${MARKER}"`,
        'parents.map(|c| c.commit_id()).join(",")',
        `"${MARKER}"`,
        "immutable",
        `"${MARKER}"`,
        'self.contained_in("::trunk()")',
        `"${MARKER}"`,
        "empty",
        `"${MARKER}"`,
        "divergent",
        `"${MARKER}"`,
        "conflict",
        `"${MARKER}"`,
        styledDescription,
        `"${MARKER}"`,
        "author.name()",
        `"${MARKER}"`,
        "author.email()",
        `"${MARKER}"`,
        'author.timestamp().local().format("%Y-%m-%d %H:%M:%S %:z")',
        `"${MARKER}"`,
        'bookmarks.map(|b| b.name()).join(",")',
        `"${MARKER}"`,
        "git_head",
        `"${MARKER}"`,
        'working_copies.map(|wc| wc.name()).join(",")',
        `"${MARKER}"`,
    ].join(" ++ ")

    return `${prefix} ++ builtin_log_compact`
}

export function parseLogOutput(output: string): Commit[] {
    const commits: Commit[] = []
    let current: Commit | null = null

    for (const line of output.split("\n")) {
        if (line.includes(MARKER)) {
            const parts = line.split(MARKER)
            if (parts.length >= 15) {
                if (current) {
                    commits.push(current)
                }

                const gutter = parts[0] ?? ""
                const hasConflict = parts.length >= 17
                const hasParentIds = parts.length >= 16
                const parentCommitIdsRaw = hasParentIds
                    ? stripAnsi(parts[3] ?? "")
                    : ""
                const metadataOffset =
                    (hasParentIds ? 1 : 0) + (hasConflict ? 1 : 0)
                const bookmarksRaw = stripAnsi(parts[11 + metadataOffset] ?? "")
                const workingCopiesRaw = stripAnsi(
                    parts[13 + metadataOffset] ?? "",
                )
                current = {
                    changeId: stripAnsi(parts[1] ?? ""),
                    commitId: stripAnsi(parts[2] ?? ""),
                    parentCommitIds: parentCommitIdsRaw
                        ? parentCommitIdsRaw.split(",")
                        : [],
                    immutable:
                        stripAnsi(parts[hasParentIds ? 4 : 3] ?? "") === "true",
                    inTrunk:
                        stripAnsi(parts[hasParentIds ? 5 : 4] ?? "") === "true",
                    empty:
                        stripAnsi(parts[hasParentIds ? 6 : 5] ?? "") === "true",
                    divergent:
                        stripAnsi(parts[hasParentIds ? 7 : 6] ?? "") === "true",
                    conflict:
                        hasConflict && stripAnsi(parts[8] ?? "") === "true",
                    description: stripAnsi(parts[7 + metadataOffset] ?? ""),
                    author: stripAnsi(parts[8 + metadataOffset] ?? ""),
                    authorEmail: stripAnsi(parts[9 + metadataOffset] ?? ""),
                    timestamp: stripAnsi(parts[10 + metadataOffset] ?? ""),
                    bookmarks: bookmarksRaw ? bookmarksRaw.split(",") : [],
                    gitHead:
                        stripAnsi(parts[hasParentIds ? 13 : 12] ?? "") ===
                        "true",
                    workingCopies: workingCopiesRaw
                        ? workingCopiesRaw.split(",")
                        : [],
                    isWorkingCopy: gutter.includes("@"),
                    refLine: parts[14 + metadataOffset] ?? "",
                    lines: [gutter + (parts[14 + metadataOffset] ?? "")],
                    displayLines: [
                        createCommitDisplayLine(
                            gutter,
                            parts[14 + metadataOffset] ?? "",
                        ),
                    ],
                }
                continue
            }
        }

        if (current && line.trim() !== "") {
            current.lines.push(line)
            const gutterWidth = getVisibleWidth(
                current.displayLines[0]?.gutter ?? "",
            )
            current.displayLines.push(
                splitAnsiAtVisibleWidth(line, gutterWidth),
            )
        }
    }

    if (current) {
        commits.push(current)
    }

    return commits
}

export interface LogStreamState {
    buffer: string
    current: Commit | null
}

function parseLogLine(line: string, state: LogStreamState): Commit | null {
    if (line.includes(MARKER)) {
        const parts = line.split(MARKER)
        if (parts.length >= 15) {
            const completed = state.current
            const gutter = parts[0] ?? ""
            const hasConflict = parts.length >= 17
            const hasParentIds = parts.length >= 16
            const parentCommitIdsRaw = hasParentIds
                ? stripAnsi(parts[3] ?? "")
                : ""
            const metadataOffset =
                (hasParentIds ? 1 : 0) + (hasConflict ? 1 : 0)
            const bookmarksRaw = stripAnsi(parts[11 + metadataOffset] ?? "")
            const workingCopiesRaw = stripAnsi(parts[13 + metadataOffset] ?? "")
            state.current = {
                changeId: stripAnsi(parts[1] ?? ""),
                commitId: stripAnsi(parts[2] ?? ""),
                parentCommitIds: parentCommitIdsRaw
                    ? parentCommitIdsRaw.split(",")
                    : [],
                immutable:
                    stripAnsi(parts[hasParentIds ? 4 : 3] ?? "") === "true",
                inTrunk:
                    stripAnsi(parts[hasParentIds ? 5 : 4] ?? "") === "true",
                empty: stripAnsi(parts[hasParentIds ? 6 : 5] ?? "") === "true",
                divergent:
                    stripAnsi(parts[hasParentIds ? 7 : 6] ?? "") === "true",
                conflict: hasConflict && stripAnsi(parts[8] ?? "") === "true",
                description: stripAnsi(parts[7 + metadataOffset] ?? ""),
                author: stripAnsi(parts[8 + metadataOffset] ?? ""),
                authorEmail: stripAnsi(parts[9 + metadataOffset] ?? ""),
                timestamp: stripAnsi(parts[10 + metadataOffset] ?? ""),
                bookmarks: bookmarksRaw ? bookmarksRaw.split(",") : [],
                gitHead:
                    stripAnsi(parts[hasParentIds ? 13 : 12] ?? "") === "true",
                workingCopies: workingCopiesRaw
                    ? workingCopiesRaw.split(",")
                    : [],
                isWorkingCopy: gutter.includes("@"),
                refLine: parts[14 + metadataOffset] ?? "",
                lines: [gutter + (parts[14 + metadataOffset] ?? "")],
                displayLines: [
                    createCommitDisplayLine(
                        gutter,
                        parts[14 + metadataOffset] ?? "",
                    ),
                ],
            }
            return completed
        }
    }

    if (state.current && line.trim() !== "") {
        state.current.lines.push(line)
        const gutterWidth = getVisibleWidth(
            state.current.displayLines[0]?.gutter ?? "",
        )
        state.current.displayLines.push(
            splitAnsiAtVisibleWidth(line, gutterWidth),
        )
    }

    return null
}

export function consumeLogChunk(
    chunk: string,
    state: LogStreamState,
): Commit[] {
    state.buffer += chunk
    const lines = state.buffer.split("\n")
    state.buffer = lines.pop() ?? ""

    const completed: Commit[] = []
    for (const line of lines) {
        const finished = parseLogLine(line, state)
        if (finished) completed.push(finished)
    }

    return completed
}

export function finalizeLogStream(state: LogStreamState): Commit[] {
    const completed: Commit[] = []
    if (state.buffer) {
        const finished = parseLogLine(state.buffer, state)
        if (finished) completed.push(finished)
        state.buffer = ""
    }
    if (state.current) {
        completed.push(state.current)
        state.current = null
    }
    return completed
}

export interface FetchLogOptions {
    cwd?: string
    revset?: string
    limit?: number
}

export interface FetchLogPageResult {
    commits: Commit[]
    hasMore: boolean
}

export function buildLogArgs(
    options: FetchLogOptions | undefined,
    template: string,
    limit?: number,
) {
    const args = ["log", "--color", "always", "--template", template]

    if (options?.revset) {
        args.push("-r", options.revset)
    }

    if (limit) {
        args.push("--limit", String(limit))
    }

    return args
}

async function executeLog(
    options: FetchLogOptions | undefined,
    limit?: number,
): Promise<string> {
    const template = buildLogTemplate()
    const args = buildLogArgs(options, template, limit)
    const result = await execute(args, {
        cwd: options?.cwd,
    })

    // Check for critical errors in both stdout and stderr (jj sometimes outputs errors to stdout)
    const combinedOutput = result.stdout + result.stderr
    if (isStaleWorkingCopyFailure(result)) {
        throw new Error(`The working copy is stale\n${combinedOutput}`)
    }

    if (!result.success) {
        throw new Error(`jj log failed: ${result.stderr}`)
    }

    return result.stdout
}

export async function fetchLogPage(
    options?: FetchLogOptions,
): Promise<FetchLogPageResult> {
    const limit = options?.limit
    const raw = await executeLog(options, limit ? limit + 1 : undefined)
    const commits = parseLogOutput(raw)

    if (!limit) {
        return { commits, hasMore: false }
    }

    if (commits.length > limit) {
        return { commits: commits.slice(0, limit), hasMore: true }
    }

    return { commits, hasMore: false }
}

export async function fetchLog(options?: FetchLogOptions): Promise<Commit[]> {
    const result = await fetchLogPage(options)
    return result.commits
}
