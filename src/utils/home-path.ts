/** Replaces a leading home directory with `~`. Only whole path segments match. */
export function abbreviateHomePath(path: string, home = process.env.HOME): string {
    if (!home || home === "/") return path
    const normalizedHome = home.endsWith("/") ? home.slice(0, -1) : home
    if (path === normalizedHome) return "~"
    if (path.startsWith(`${normalizedHome}/`)) return `~${path.slice(normalizedHome.length)}`
    return path
}
