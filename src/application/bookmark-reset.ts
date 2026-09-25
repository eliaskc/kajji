import type { Bookmark } from "../commander/bookmarks"
import { remoteBookmarkRevset } from "../commander/bookmarks"
import type { JjRevisionSummary } from "../commander/jj"
import type { CommandObserver } from "../commander/observer"
import type { OperationResult } from "../process/operation-result"
import type { ApplicationClient } from "./client"

/**
 * - `abandon`: move the bookmark and abandon the local-only commits.
 * - `keep`: move the bookmark and leave the local-only commits in place.
 */
export type BookmarkResetMode = "abandon" | "keep"

export interface BookmarkResetPlan {
    readonly name: string
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
    "jjRevisionSummaries" | "jjFiles" | "jjBookmarkSet" | "jjAbandon"
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
    if (localIds.length === 0) {
        return {
            name: local.name,
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
        name: local.name,
        localOnly,
        sameContent: files !== null && files.length === 0,
        descendants: descendants.length,
        affectsWorkingCopy: workingCopy.length > 0,
    }
}

/** Modes that make sense for a plan. The first mode is the default. */
export function availableResetModes(plan: BookmarkResetPlan): BookmarkResetMode[] {
    return plan.localOnly.length === 0 ? ["keep"] : ["abandon", "keep"]
}

/**
 * Moves the bookmark to origin, then abandons the local-only commits unless
 * the mode keeps them. Each operation goes through `run`, which records it.
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

    const moved = await run((observer) =>
        app.jjBookmarkSet(plan.name, origin, { ...options, observer, allowBackwards: true }),
    )
    if (!moved.success || mode === "keep" || abandonIds.length === 0) return moved

    return run((observer) => app.jjAbandon(abandonIds.join("|"), { ...options, observer }))
}
