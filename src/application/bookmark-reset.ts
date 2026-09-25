import type { Bookmark } from "../commander/bookmarks"
import { remoteBookmarkRevset } from "../commander/bookmarks"
import type { JjRevisionSummary } from "../commander/jj"
import type { CommandObserver } from "../commander/observer"
import type { OperationResult } from "../process/operation-result"
import type { ApplicationClient } from "./client"

/**
 * - `abandon`: move the bookmark and abandon the local-only commits.
 * - `keep`: move the bookmark and leave the local-only commits in place.
 * - `new-commit`: put the local content in a new commit on origin, then abandon.
 */
export type BookmarkResetMode = "abandon" | "keep" | "new-commit"

export interface BookmarkResetPlan {
    readonly name: string
    /** Local target commit IDs. Empty for a deleted local bookmark; several for a conflict. */
    readonly localCommitIds: readonly string[]
    readonly originCommitId: string
    /** Mutable commits that only the local bookmark reaches. Reset leaves them behind. */
    readonly localOnly: readonly JjRevisionSummary[]
    /** True when the local and origin trees are equal (for example after a rebase). */
    readonly sameContent: boolean
    /** Visible descendants of `localOnly` that abandon would rebase. */
    readonly descendants: number
    /** True when `@` is in `localOnly` or is one of its descendants. */
    readonly affectsWorkingCopy: boolean
}

type ResetClient = Pick<
    ApplicationClient,
    | "jjRevisionSummaries"
    | "jjFiles"
    | "jjShowDescription"
    | "jjBookmarkSet"
    | "jjNew"
    | "jjRestore"
    | "jjAbandon"
>

interface ResetReadOptions {
    readonly cwd: string
    readonly signal?: AbortSignal
}

export type ResetOperationRunner = (
    op: (observer: CommandObserver | undefined) => Promise<OperationResult>,
) => Promise<OperationResult>

function localCommitIds(bookmark: Bookmark) {
    return bookmark.commitId
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
}

function anyOf(ids: readonly string[]) {
    return `(${ids.join("|")})`
}

/**
 * Commits reachable from the local target but not from origin. It excludes
 * immutable commits (for example a newer trunk after a rebase) and ancestors
 * of other bookmarks, so a reset never removes work that something else uses.
 */
export function localOnlyRevset(name: string, localIds: readonly string[], originId: string) {
    const others = `bookmarks(~exact:${JSON.stringify(name)}) | remote_bookmarks(~exact:${JSON.stringify(name)})`
    return `((::${anyOf(localIds)} ~ ::${originId}) & mutable()) ~ ::(${others})`
}

export async function planBookmarkReset(
    app: ResetClient,
    local: Bookmark,
    origin: Bookmark,
    options: ResetReadOptions,
): Promise<BookmarkResetPlan> {
    const localIds = localCommitIds(local)
    const base = {
        name: local.name,
        localCommitIds: localIds,
        originCommitId: origin.commitId,
    }
    if (localIds.length === 0) {
        return {
            ...base,
            localOnly: [],
            sameContent: false,
            descendants: 0,
            affectsWorkingCopy: false,
        }
    }

    const localOnlyExpression = localOnlyRevset(local.name, localIds, origin.commitId)
    const [localOnly, descendants, workingCopy, files] = await Promise.all([
        app.jjRevisionSummaries(localOnlyExpression, options),
        app.jjRevisionSummaries(`(${localOnlyExpression}):: ~ (${localOnlyExpression})`, options),
        app.jjRevisionSummaries(`(${localOnlyExpression}):: & @`, options),
        localIds.length === 1
            ? app.jjFiles({ from: origin.commitId, to: localIds[0] as string }, options)
            : Promise.resolve(null),
    ])

    return {
        ...base,
        localOnly,
        sameContent: files !== null && files.length === 0,
        descendants: descendants.length,
        affectsWorkingCopy: workingCopy.length > 0,
    }
}

/** Modes that make sense for a plan. The first mode is the default. */
export function availableResetModes(plan: BookmarkResetPlan): BookmarkResetMode[] {
    if (plan.localOnly.length === 0) return ["keep"]
    const newCommit = !plan.sameContent && plan.localCommitIds.length === 1
    return newCommit ? ["abandon", "keep", "new-commit"] : ["abandon", "keep"]
}

function failure(command: string, stderr: string): OperationResult {
    return { command, success: false, exitCode: 1, stdout: "", stderr }
}

/**
 * Runs the jj operations for one reset mode. Each operation goes through
 * `run`, which records it; the sequence stops at the first failure.
 */
export async function runBookmarkReset(
    app: ResetClient,
    plan: BookmarkResetPlan,
    mode: BookmarkResetMode,
    run: ResetOperationRunner,
    options: ResetReadOptions,
): Promise<OperationResult> {
    const origin = remoteBookmarkRevset(plan.name, "origin")
    const abandonIds = plan.localOnly.map((commit) => commit.commitId)

    if (mode === "new-commit") {
        const local = plan.localCommitIds[0]
        if (!local || plan.localCommitIds.length !== 1) {
            return failure("reset to origin", "Cannot keep changes of a conflicted bookmark")
        }
        const childrenRevset = `children(${plan.originCommitId})`
        const [before, description] = await Promise.all([
            app.jjRevisionSummaries(childrenRevset, options),
            app.jjShowDescription(local, options),
        ])
        const message = description.body
            ? `${description.subject}\n\n${description.body}`
            : description.subject
        const created = await run((observer) =>
            app.jjNew(plan.originCommitId, { ...options, observer, noEdit: true, message }),
        )
        if (!created.success) return created

        const known = new Set(before.map((commit) => commit.commitId))
        const after = await app.jjRevisionSummaries(childrenRevset, options)
        const added = after.filter((commit) => !known.has(commit.commitId))
        const target = added[0]
        if (!target || added.length !== 1) {
            return failure("reset to origin", "Could not find the new commit on top of origin")
        }

        const restored = await run((observer) =>
            app.jjRestore([], { ...options, observer, from: local, into: target.commitId }),
        )
        if (!restored.success) return restored
    }

    const moved = await run((observer) =>
        app.jjBookmarkSet(plan.name, origin, { ...options, observer, allowBackwards: true }),
    )
    if (!moved.success || mode === "keep" || abandonIds.length === 0) return moved

    return run((observer) => app.jjAbandon(abandonIds.join("|"), { ...options, observer }))
}
