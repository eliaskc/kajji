import type { OperationResult } from "../process/operation-result"

const BOOKMARK_MARKER = "__BJ__"
const BOOKMARK_DESCRIPTION =
    'if(normal_target, if(normal_target.empty(), label("empty", "(empty) "), "") ++ if(normal_target.description().first_line(), normal_target.description().first_line(), label("description placeholder", "(no description set)")), "")'

export const BOOKMARK_TEMPLATE = [
    `"${BOOKMARK_MARKER}"`,
    "name",
    `"${BOOKMARK_MARKER}"`,
    'label("bookmark name", name)',
    `"${BOOKMARK_MARKER}"`,
    'if(remote, remote, "")',
    `"${BOOKMARK_MARKER}"`,
    'pad_end(8, truncate_end(8, coalesce(if(normal_target, format_short_change_id(normal_target.change_id()), ""), self.added_targets().map(|c| format_short_change_id(c.change_id())).join(","), self.removed_targets().map(|c| format_short_change_id(c.change_id())).join(","))))',
    `"${BOOKMARK_MARKER}"`,
    'coalesce(if(normal_target, format_short_commit_id(normal_target.commit_id()), ""), self.added_targets().map(|c| format_short_commit_id(c.commit_id())).join(","), self.removed_targets().map(|c| format_short_commit_id(c.commit_id())).join(","))',
    `"${BOOKMARK_MARKER}"`,
    'coalesce(if(normal_target, normal_target.change_id(), ""), self.added_targets().map(|c| c.change_id()).join(","), self.removed_targets().map(|c| c.change_id()).join(","))',
    `"${BOOKMARK_MARKER}"`,
    'coalesce(if(normal_target, normal_target.commit_id(), ""), self.added_targets().map(|c| c.commit_id()).join(","), self.removed_targets().map(|c| c.commit_id()).join(","))',
    `"${BOOKMARK_MARKER}"`,
    `coalesce(${BOOKMARK_DESCRIPTION}, self.added_targets().map(|c| if(c.empty(), label("empty", "(empty) "), "") ++ if(c.description().first_line(), c.description().first_line(), label("description placeholder", "(no description set)"))).join(", "), self.removed_targets().map(|c| if(c.empty(), label("empty", "(empty) "), "") ++ if(c.description().first_line(), c.description().first_line(), label("description placeholder", "(no description set)"))).join(", "))`,
    '"\\n"',
].join(" ++ ")

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

export interface Bookmark {
    name: string
    nameDisplay: string
    changeId: string
    commitId: string
    changeIdDisplay: string
    commitIdDisplay: string
    descriptionDisplay: string
    description: string
    isLocal: boolean
    remote?: string
}

export function parseBookmarkOutput(output: string): Bookmark[] {
    const bookmarks: Bookmark[] = []

    for (const line of output.split("\n")) {
        if (!line.includes(BOOKMARK_MARKER)) continue
        const parts = line.split(BOOKMARK_MARKER)
        if (parts.length < 9) continue

        const name = stripAnsi(parts[1] ?? "")
        const nameDisplay = parts[2] ?? ""
        const remote = stripAnsi(parts[3] ?? "")
        const changeIdDisplay = parts[4] ?? ""
        const commitIdDisplay = parts[5] ?? ""
        const changeId = stripAnsi(parts[6] ?? "")
        const commitId = stripAnsi(parts[7] ?? "")
        const descriptionDisplay = parts[8] ?? ""
        const isLocal = remote.length === 0

        bookmarks.push({
            name,
            nameDisplay,
            changeId,
            commitId,
            changeIdDisplay,
            commitIdDisplay,
            descriptionDisplay,
            description: stripAnsi(descriptionDisplay).trim(),
            isLocal,
            remote: isLocal ? undefined : remote,
        })
    }

    return bookmarks
}

export function isBookmarkBackwardsError(result: OperationResult): boolean {
    if (result.success) return false
    const combined = `${result.stdout}\n${result.stderr}`
    return /allow-backwards/i.test(combined) || /backward/i.test(combined)
}
