import type { UntrackedLargeFile } from "../commander/snapshot-warnings"

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const

/** Binary size, e.g. `1.9 MiB`, close to how jj prints file sizes. */
export function formatByteSize(bytes: number): string {
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024
        unit++
    }
    return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${UNITS[unit]}`
}

/** The shared limit, or undefined when files report different limits. */
export function sharedSizeLimit(files: readonly UntrackedLargeFile[]): number | undefined {
    const first = files[0]?.maxSize
    return files.every((file) => file.maxSize === first) ? first : undefined
}

export const REFUSED_TO_SNAPSHOT = "Refused to snapshot"

/** `over 1.0 MiB limit` */
export function untrackedLargeFilesLimitText(limit: number | undefined): string {
    return limit === undefined ? "over size limit" : `over ${formatByteSize(limit)} limit`
}

/** `Refused to snapshot: over 1.0 MiB limit` */
export function untrackedLargeFilesTitle(limit: number | undefined): string {
    return `${REFUSED_TO_SNAPSHOT}: ${untrackedLargeFilesLimitText(limit)}`
}

/** Short title for the narrow files panel: `Refused: over 1.0 MiB limit` */
export function untrackedLargeFilesShortTitle(limit: number | undefined): string {
    return `Refused: ${untrackedLargeFilesLimitText(limit)}`
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

const shellQuote = (value: string) =>
    /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`

/** Command log entry: title, aligned paths with sizes, and how to fix it. */
export function untrackedLargeFilesWarning(files: readonly UntrackedLargeFile[]): {
    message: string
    output: string
} {
    const limit = sharedSizeLimit(files)
    const limitText = limit === undefined ? "the size limit" : `the ${formatByteSize(limit)} limit`
    const onlyFile = files.length === 1 ? files[0] : undefined
    const pathArgs = onlyFile ? shellQuote(onlyFile.path) : "<path>"
    const pathWidth = Math.max(0, ...files.map((file) => file.path.length))
    const lines = files.map(
        (file) => `  ${file.path.padEnd(pathWidth)}  ${formatByteSize(file.size)}`,
    )
    return {
        message: `Refused to snapshot: ${plural(files.length, "new file")} over ${limitText}`,
        output: [
            ...lines,
            "To track, run `jj file track --include-ignored " +
                pathArgs +
                "` or increase snapshot.max-new-file-size.",
            "To stop this warning, add the path to .gitignore.",
        ].join("\n"),
    }
}

export function untrackedLargeFilesClearedMessage(files: readonly UntrackedLargeFile[]): string {
    const paths = files.map((file) => file.path).join(", ")
    return `Large-file warning cleared: ${paths}`
}
