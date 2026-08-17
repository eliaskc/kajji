import type { Commit } from "./types"

const MARKER = "__LJ__"

// oxlint-disable-next-line no-control-regex -- intentional ANSI escape sequence
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
        'committer.timestamp().local().format("%Y-%m-%d %H:%M:%S %:z")',
        `"${MARKER}"`,
        'bookmarks.map(|b| b.name()).join(",")',
        `"${MARKER}"`,
        'working_copies.map(|wc| wc.name()).join(",")',
        `"${MARKER}"`,
    ].join(" ++ ")

    return `${prefix} ++ builtin_log_compact`
}

export function parseLogOutput(output: string): Commit[] {
    const commits: Commit[] = []
    const state: LogStreamState = { buffer: "", current: null }

    for (const line of output.split("\n")) {
        const completed = parseLogLine(line, state)
        if (completed) commits.push(completed)
    }

    if (state.current) {
        commits.push(state.current)
    }

    return commits
}

export interface LogStreamState {
    buffer: string
    current: Commit | null
}

// The template produces 17 marker-separated parts per commit line:
// gutter, changeId, commitId, parentCommitIds, immutable, inTrunk, empty,
// divergent, conflict, description, author, email, authorTimestamp,
// committerTimestamp, bookmarks, workingCopies, refLine.
const TEMPLATE_PART_COUNT = 17

function parseLogLine(line: string, state: LogStreamState): Commit | null {
    if (line.includes(MARKER)) {
        const parts = line.split(MARKER)
        if (parts.length >= TEMPLATE_PART_COUNT) {
            const completed = state.current
            const gutter = parts[0] ?? ""
            const parentCommitIdsRaw = stripAnsi(parts[3] ?? "")
            const bookmarksRaw = stripAnsi(parts[14] ?? "")
            const workingCopiesRaw = stripAnsi(parts[15] ?? "")
            const refLine = parts[16] ?? ""
            state.current = {
                changeId: stripAnsi(parts[1] ?? ""),
                commitId: stripAnsi(parts[2] ?? ""),
                parentCommitIds: parentCommitIdsRaw ? parentCommitIdsRaw.split(",") : [],
                immutable: stripAnsi(parts[4] ?? "") === "true",
                inTrunk: stripAnsi(parts[5] ?? "") === "true",
                empty: stripAnsi(parts[6] ?? "") === "true",
                divergent: stripAnsi(parts[7] ?? "") === "true",
                conflict: stripAnsi(parts[8] ?? "") === "true",
                description: stripAnsi(parts[9] ?? ""),
                author: stripAnsi(parts[10] ?? ""),
                authorEmail: stripAnsi(parts[11] ?? ""),
                timestamp: stripAnsi(parts[12] ?? ""),
                committerTimestamp: stripAnsi(parts[13] ?? ""),
                bookmarks: bookmarksRaw ? bookmarksRaw.split(",") : [],
                workingCopies: workingCopiesRaw ? workingCopiesRaw.split(",") : [],
                isWorkingCopy: gutter.includes("@"),
                refLine,
                lines: [gutter + refLine],
                displayLines: [createCommitDisplayLine(gutter, refLine)],
            }
            return completed
        }
    }

    if (state.current && line.trim() !== "") {
        state.current.lines.push(line)
        const gutterWidth = getVisibleWidth(state.current.displayLines[0]?.gutter ?? "")
        state.current.displayLines.push(splitAnsiAtVisibleWidth(line, gutterWidth))
    }

    return null
}

export function consumeLogChunk(chunk: string, state: LogStreamState): Commit[] {
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

export interface LogPageResult {
    commits: Commit[]
    hasMore: boolean
}

export function buildLogArgs(
    options: { readonly revset?: string } | undefined,
    template: string,
    limit?: number,
) {
    const args = ["log", "--color", "always", "--template", template]

    if (options?.revset) args.push("-r", options.revset)
    if (limit) args.push("--limit", String(limit))

    return args
}
