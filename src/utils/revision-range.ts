import type { Commit } from "../commander/types"

export interface RevisionRange {
    /**
     * Commits on the ancestry chain between the endpoints, in log order
     * (newest first). When the endpoints are not connected within the given
     * commits, this is a local estimate: the partial segments hanging off
     * each endpoint.
     */
    chain: Commit[]
    /**
     * False when the chain crosses elided revisions or the endpoints are on
     * sibling branches; the caller should then resolve the real range via jj.
     */
    connected: boolean
}

/**
 * Compute the chain of revisions between two log rows. The jj log
 * interleaves sibling branches into one flat list, so rows between the
 * endpoints are only included when they lie on an ancestry path between
 * them.
 */
export function connectedRevisionRange(
    commits: Commit[],
    anchorIndex: number,
    cursorIndex: number,
): RevisionRange {
    const lo = Math.max(0, Math.min(anchorIndex, cursorIndex))
    const hi = Math.min(commits.length - 1, Math.max(anchorIndex, cursorIndex))
    if (lo > hi) return { chain: [], connected: false }
    const slice = commits.slice(lo, hi + 1)
    if (slice.length <= 1) return { chain: slice, connected: true }

    const top = slice[0]
    const bottom = slice[slice.length - 1]
    if (!top || !bottom) return { chain: slice, connected: false }

    const byCommitId = new Map(slice.map((commit) => [commit.commitId, commit]))

    // Ancestors of the top endpoint within the slice.
    const ancestors = new Set<string>()
    const parentStack = [top.commitId]
    while (parentStack.length > 0) {
        const id = parentStack.pop()
        if (id === undefined || ancestors.has(id)) continue
        const commit = byCommitId.get(id)
        if (!commit) continue
        ancestors.add(id)
        for (const parentId of commit.parentCommitIds ?? []) {
            parentStack.push(parentId)
        }
    }

    // Descendants of the bottom endpoint within the slice.
    const childrenByParent = new Map<string, string[]>()
    for (const commit of slice) {
        for (const parentId of commit.parentCommitIds ?? []) {
            if (!byCommitId.has(parentId)) continue
            const children = childrenByParent.get(parentId)
            if (children) {
                children.push(commit.commitId)
            } else {
                childrenByParent.set(parentId, [commit.commitId])
            }
        }
    }
    const descendants = new Set<string>()
    const childStack = [bottom.commitId]
    while (childStack.length > 0) {
        const id = childStack.pop()
        if (id === undefined || descendants.has(id)) continue
        descendants.add(id)
        for (const childId of childrenByParent.get(id) ?? []) {
            childStack.push(childId)
        }
    }

    if (ancestors.has(bottom.commitId)) {
        return {
            chain: slice.filter(
                (commit) => ancestors.has(commit.commitId) && descendants.has(commit.commitId),
            ),
            connected: true,
        }
    }

    // Not connected within the slice: estimate with the partial segments
    // off each endpoint so rows highlight immediately while jj resolves.
    return {
        chain: slice.filter(
            (commit) => ancestors.has(commit.commitId) || descendants.has(commit.commitId),
        ),
        connected: false,
    }
}
