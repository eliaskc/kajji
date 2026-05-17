export interface StackCommitInput {
    readonly commitId: string
    readonly parentCommitIds?: readonly string[]
    readonly immutable: boolean
}

export interface StackBookmarkInput {
    readonly name: string
    readonly commitId: string
    readonly changeId?: string
}

export interface BookmarkStackRow<TBookmark extends StackBookmarkInput> {
    readonly bookmark: TBookmark
    readonly depth: number
    /** Stack roots this row belongs to. Trunk rows can belong to multiple stacks. */
    readonly stackKeys: readonly string[]
}

export interface BookmarkStackModel<TBookmark extends StackBookmarkInput> {
    readonly rows: readonly BookmarkStackRow<TBookmark>[]
    readonly parentByName: ReadonlyMap<string, string>
    readonly childrenByName: ReadonlyMap<string, readonly TBookmark[]>
    readonly trunkNames: ReadonlySet<string>
    readonly stackRootNames: ReadonlySet<string>
}

export interface StackPullRequestInput {
    readonly number: number
    readonly headRefName: string
    readonly baseRefName?: string
}

export interface StackRemoteBookmarkInput {
    readonly name: string
    readonly commitId: string
}

export type StackPlanKind = "submit" | "sync"
export type StackPlanRowStatus =
    | "current"
    | "create-pr"
    | "update-pr"
    | "push"
    | "rebase"

export interface StackPlanRow<TBookmark extends StackBookmarkInput> {
    readonly row: BookmarkStackRow<TBookmark>
    readonly prNumber?: number
    readonly desiredBase?: string
    readonly status: StackPlanRowStatus
    readonly note: string
}

export interface StackPlan<TBookmark extends StackBookmarkInput> {
    readonly kind: StackPlanKind
    readonly stackRootName: string
    readonly rows: readonly StackPlanRow<TBookmark>[]
    readonly updatePrNumbers: readonly number[]
    readonly createPrBookmarks: readonly string[]
    readonly pushBookmarks: readonly string[]
    readonly rebaseBookmarks: readonly string[]
    readonly applyCommand: string
}
