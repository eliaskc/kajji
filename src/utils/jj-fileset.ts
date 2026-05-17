function quoteFilesetPath(path: string): string {
    const escaped = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    return `"${escaped}"`
}

export function toFilesetArgs(paths: string[]): string[] {
    return paths.map((path) => `file:${quoteFilesetPath(path)}`)
}
