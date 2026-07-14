import { type Commit, getRevisionId } from "../commander/types"

export type RevisionRestorePlan =
    | { supported: true; from?: string; into?: string }
    | { supported: false; message: string }

export function getRevisionRestorePlan(commit: Commit): RevisionRestorePlan {
    if (commit.isWorkingCopy) return { supported: true }
    if (commit.immutable) {
        return {
            supported: false,
            message: "Can't discard changes from an immutable revision.",
        }
    }
    if (commit.parentCommitIds?.length !== 1) {
        return {
            supported: false,
            message: "Discarding from root or merge revisions isn't supported.",
        }
    }

    return {
        supported: true,
        from: commit.parentCommitIds[0],
        into: getRevisionId(commit),
    }
}
