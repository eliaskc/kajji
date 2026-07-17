import type { FileChange, FileStatus } from "./types"

const STATUS_MAP: Record<string, FileStatus> = {
    A: "added",
    M: "modified",
    D: "deleted",
    R: "renamed",
    C: "copied",
}

const BRACED_RENAME_REGEX = /^(.*)\{(.+) => (.+)\}(.*)$/

function parseRenamedPath(rawPath: string): {
    oldPath: string
    newPath: string
} {
    const match = rawPath.match(BRACED_RENAME_REGEX)
    if (match?.[2] && match[3]) {
        const prefix = match[1] ?? ""
        const suffix = match[4] ?? ""
        return {
            oldPath: prefix + match[2] + suffix,
            newPath: prefix + match[3] + suffix,
        }
    }

    const arrowIndex = rawPath.indexOf(" => ")
    if (arrowIndex !== -1) {
        return {
            oldPath: rawPath.slice(0, arrowIndex),
            newPath: rawPath.slice(arrowIndex + 4),
        }
    }

    return { oldPath: rawPath, newPath: rawPath }
}

export function parseFileSummary(output: string): FileChange[] {
    const files: FileChange[] = []

    for (const line of output.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue

        const status = STATUS_MAP[trimmed[0] ?? ""]
        if (!status) continue
        const rawPath = trimmed.slice(2)

        if (status === "renamed" || status === "copied") {
            const { oldPath, newPath } = parseRenamedPath(rawPath)
            files.push({ path: newPath, status, oldPath })
        } else {
            files.push({ path: rawPath, status })
        }
    }

    return files
}
