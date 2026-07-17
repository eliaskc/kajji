export interface OpLogEntry {
    operationId: string
    lines: string[]
    isCurrent: boolean
}

function stripAnsi(str: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence
    return str.replace(/\x1b\[[0-9;]*m/g, "")
}

export function parseOpLog(lines: string[]): OpLogEntry[] {
    const operations: OpLogEntry[] = []
    let current: OpLogEntry | null = null

    for (const line of lines) {
        const stripped = stripAnsi(line)
        const isHeader = stripped.startsWith("@") || stripped.startsWith("○")

        if (isHeader) {
            if (current) operations.push(current)
            const parts = stripped.split(/\s+/)
            current = {
                operationId: parts[1] || "",
                lines: [line],
                isCurrent: stripped.startsWith("@"),
            }
        } else if (current && stripped.trim()) {
            current.lines.push(line)
        }
    }

    if (current) operations.push(current)
    return operations
}
