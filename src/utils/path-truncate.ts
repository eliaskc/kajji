export interface DisplayPathSegments {
    directory: string
    fileName: string
    suffix: string
}

export function splitDisplayPath(text: string): DisplayPathSegments {
    const suffixStart = text.indexOf(" ← ")
    const pathEnd = suffixStart === -1 ? text.length : suffixStart
    const fileNameStart = text.lastIndexOf("/", pathEnd - 1) + 1

    return {
        directory: text.slice(0, fileNameStart),
        fileName: text.slice(fileNameStart, pathEnd),
        suffix: text.slice(pathEnd),
    }
}

function hardTruncate(
    text: string,
    maxLength: number,
    keepEnd: boolean,
): string {
    if (text.length <= maxLength) return text
    if (maxLength <= 0) return ""
    return keepEnd
        ? text.slice(text.length - maxLength)
        : text.slice(0, maxLength)
}

export function truncatePathMiddle(path: string, maxLength: number): string {
    if (path.length <= maxLength) return path
    if (maxLength <= 3) return "..."

    const parts = path.split("/")
    if (parts.length <= 1) return hardTruncate(path, maxLength, true)

    const first = parts[0] ?? ""
    const last = parts[parts.length - 1] ?? ""
    const fixed = "/.../"
    const available = maxLength - fixed.length

    if (available <= 0) return "..."

    const minEnd = Math.min(
        last.length,
        Math.max(1, Math.ceil(available * 0.6)),
    )
    const minStart = Math.max(1, available - minEnd)
    const start = hardTruncate(first, minStart, false)
    const end = hardTruncate(last, available - start.length, true)

    return `${start}${fixed}${end}`
}
