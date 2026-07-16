import { dirname, resolve } from "node:path"
import { getRepoPath } from "../repo"

export interface PersistedStackEntry {
    readonly bookmark: string
    readonly parent: string
    readonly prNumber?: number
    readonly headChangeId?: string
    readonly headCommitId?: string
    readonly parentChangeId?: string
    readonly parentCommitId?: string
    readonly baseRefName?: string
    readonly syncedAt: string
}

export interface PersistedStackState {
    readonly version: 1
    readonly entries: readonly PersistedStackEntry[]
}

const emptyState = (): PersistedStackState => ({ version: 1, entries: [] })

export async function stackStatePath(
    repositoryRoot = getRepoPath(),
): Promise<string> {
    const root = repositoryRoot
    const jjRepoFile = `${root}/.jj/repo`
    let repoPath = jjRepoFile
    try {
        const stat = await import("node:fs/promises").then((fs) =>
            fs.stat(jjRepoFile),
        )
        if (stat.isFile()) {
            const pointer = (await Bun.file(jjRepoFile).text()).trim()
            repoPath = resolve(dirname(jjRepoFile), pointer)
        }
    } catch {
        repoPath = `${root}/.jj/repo`
    }
    return `${repoPath}/kajji/stack-state.json`
}

export async function readPersistedStackState(
    repositoryRoot = getRepoPath(),
): Promise<PersistedStackState> {
    try {
        const path = await stackStatePath(repositoryRoot)
        const raw = await Bun.file(path).text()
        const parsed = JSON.parse(raw) as Partial<PersistedStackState>
        if (parsed.version !== 1 || !Array.isArray(parsed.entries))
            return emptyState()
        return { version: 1, entries: parsed.entries }
    } catch {
        return emptyState()
    }
}

export async function writePersistedStackState(
    state: PersistedStackState,
    repositoryRoot = getRepoPath(),
): Promise<void> {
    const path = await stackStatePath(repositoryRoot)
    await import("node:fs/promises").then((fs) =>
        fs.mkdir(dirname(path), { recursive: true }),
    )
    await Bun.write(path, `${JSON.stringify(state, null, 2)}\n`)
}

export function entriesByBookmark(state: PersistedStackState) {
    return new Map(state.entries.map((entry) => [entry.bookmark, entry]))
}
