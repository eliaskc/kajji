import type { Commit } from "../commander/types"

/**
 * Finds the index of `selected` in `commits` by identity, not position.
 * Prefers an exact commit ID match (handles divergent changes), then falls
 * back to the change ID (handles rewrites). Returns null when not found.
 */
export function findCommitIndex(
    commits: readonly Commit[],
    selected: Pick<Commit, "changeId" | "commitId"> | undefined,
): number | null {
    if (!selected) return null
    const byCommit = commits.findIndex((commit) => commit.commitId === selected.commitId)
    if (byCommit >= 0) return byCommit
    const byChange = commits.findIndex((commit) => commit.changeId === selected.changeId)
    return byChange >= 0 ? byChange : null
}
