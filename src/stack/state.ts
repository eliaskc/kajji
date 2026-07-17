import { dirname, resolve } from "node:path"
import { Schema } from "effect"
import { getRepoPath } from "../repo"
import { writeFileAtomicDurable } from "../utils/atomic-write"

export const PersistedStackEntry = Schema.Struct({
    bookmark: Schema.String,
    parent: Schema.String,
    prNumber: Schema.optionalKey(Schema.Number),
    headChangeId: Schema.optionalKey(Schema.String),
    headCommitId: Schema.optionalKey(Schema.String),
    parentChangeId: Schema.optionalKey(Schema.String),
    parentCommitId: Schema.optionalKey(Schema.String),
    baseRefName: Schema.optionalKey(Schema.String),
    syncedAt: Schema.String,
})

export interface PersistedStackEntry
    extends Schema.Schema.Type<typeof PersistedStackEntry> {}

export const PersistedStackState = Schema.Struct({
    version: Schema.Literal(1),
    entries: Schema.Array(PersistedStackEntry),
})

export interface PersistedStackState
    extends Schema.Schema.Type<typeof PersistedStackState> {}

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

function isMissingFile(error: unknown): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    )
}

export async function readPersistedStackState(
    repositoryRoot = getRepoPath(),
): Promise<PersistedStackState> {
    const path = await stackStatePath(repositoryRoot)
    let raw: string
    try {
        raw = await Bun.file(path).text()
    } catch (error) {
        if (isMissingFile(error)) return emptyState()
        throw error
    }
    return Schema.decodeUnknownPromise(PersistedStackState)(JSON.parse(raw))
}

export async function writePersistedStackState(
    state: PersistedStackState,
    repositoryRoot = getRepoPath(),
): Promise<void> {
    const path = await stackStatePath(repositoryRoot)
    await writeFileAtomicDurable(path, `${JSON.stringify(state, null, 2)}\n`)
}

export function entriesByBookmark(state: PersistedStackState) {
    return new Map(state.entries.map((entry) => [entry.bookmark, entry]))
}
