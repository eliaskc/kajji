/** A new working-copy file that jj refused to snapshot because it exceeds `snapshot.max-new-file-size`. */
export interface UntrackedLargeFile {
    /** Path as jj printed it, relative to the command's working directory. */
    readonly path: string
    readonly size: number
    readonly maxSize: number
}

const REFUSED_HEADER = "Refused to snapshot some files:"
const REFUSED_ENTRY =
    /^ {2}(.+): \S+ \((\d+) bytes\); the maximum size allowed is \S+ \((\d+) bytes\)\s*$/

// oxlint-disable-next-line no-control-regex -- ANSI escape sequence
const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "")

/** Cheap pre-check so callers can skip parsing ordinary command output. */
export function hasRefusedSnapshotWarning(output: string): boolean {
    return output.includes(REFUSED_HEADER)
}

/**
 * Parse jj's "Refused to snapshot some files" warning. jj prints it on stderr for every
 * snapshot that skips a new file because it is too large; the command still succeeds.
 */
export function parseRefusedSnapshotFiles(output: string): UntrackedLargeFile[] {
    if (!hasRefusedSnapshotWarning(output)) return []
    const files = new Map<string, UntrackedLargeFile>()
    let inBlock = false
    for (const line of stripAnsi(output).split(/\r?\n/)) {
        if (line.includes(REFUSED_HEADER)) {
            inBlock = true
            continue
        }
        if (!inBlock) continue
        const match = REFUSED_ENTRY.exec(line)
        if (!match) {
            inBlock = false
            continue
        }
        const [, path, size, maxSize] = match
        if (!path || !size || !maxSize) continue
        files.set(path, { path, size: Number(size), maxSize: Number(maxSize) })
    }
    return sortUntrackedLargeFiles([...files.values()])
}

const LARGE_FILE_HINT = "Hint: This is to prevent large files from being added by accident"

/**
 * Remove jj's refused-snapshot warning and its hint from command output. kajji shows
 * these files in its own format, so the raw block is only noise.
 */
export function stripRefusedSnapshotWarning(output: string): string {
    if (!hasRefusedSnapshotWarning(output)) return output
    const kept: string[] = []
    let state: "none" | "entries" | "hint" = "none"
    for (const line of output.split("\n")) {
        const plain = stripAnsi(line).replace(/\r$/, "")
        if (plain.includes(REFUSED_HEADER)) {
            state = "entries"
            continue
        }
        if (state === "entries" && REFUSED_ENTRY.test(plain)) continue
        if (state !== "none" && plain.startsWith(LARGE_FILE_HINT)) {
            state = "hint"
            continue
        }
        if (state === "hint" && plain.startsWith("  ")) continue
        state = "none"
        kept.push(line)
    }
    return kept.join("\n")
}

export function sortUntrackedLargeFiles(
    files: readonly UntrackedLargeFile[],
): UntrackedLargeFile[] {
    return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Merge a new report into known files. Newer reports win for the same path. */
export function mergeUntrackedLargeFiles(
    current: readonly UntrackedLargeFile[],
    reported: readonly UntrackedLargeFile[],
): UntrackedLargeFile[] {
    const byPath = new Map(current.map((file) => [file.path, file]))
    for (const file of reported) byPath.set(file.path, file)
    return sortUntrackedLargeFiles([...byPath.values()])
}

export function sameUntrackedLargeFiles(
    a: readonly UntrackedLargeFile[],
    b: readonly UntrackedLargeFile[],
): boolean {
    if (a.length !== b.length) return false
    return a.every((file, index) => {
        const other = b[index]
        return (
            other !== undefined &&
            file.path === other.path &&
            file.size === other.size &&
            file.maxSize === other.maxSize
        )
    })
}
