export interface StackCommitInput {
    readonly commitId: string
    readonly parentCommitIds?: readonly string[]
    readonly immutable: boolean
}

export interface StackBookmarkInput {
    readonly name: string
    readonly commitId: string
    readonly changeId?: string
    readonly description?: string
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
    readonly state?: string
    readonly merged?: boolean
}

export interface StackRemoteBookmarkInput {
    readonly name: string
    readonly commitId: string
}

export type StackPlanKind = "sync"
export type StackPlanEffectType =
    | "create-pr"
    | "update-pr"
    | "push"
    | "rebase"
    | "abandon"
    | "abandon-landed-range"
    | "update-comment"
    | "close-pr"
    | "blocked"

export interface StackPlanEffect {
    readonly type: StackPlanEffectType
    readonly bookmark: string
    readonly prNumber?: number
    readonly from?: string
    readonly to?: string
    readonly reason?: string
    readonly revision?: string
    readonly range?: string
}

export type StackPlanRowStatus = "current" | StackPlanEffectType

export interface StackPlanRow<TBookmark extends StackBookmarkInput> {
    readonly row: BookmarkStackRow<TBookmark>
    readonly prNumber?: number
    readonly desiredBase?: string
    readonly status: StackPlanRowStatus
    readonly note: string
    readonly effects: readonly StackPlanEffect[]
}

export interface StackPlan<TBookmark extends StackBookmarkInput> {
    readonly kind: StackPlanKind
    readonly stackRootName: string
    readonly rows: readonly StackPlanRow<TBookmark>[]
    readonly effects: readonly StackPlanEffect[]
    readonly updatePrNumbers: readonly number[]
    readonly createPrBookmarks: readonly string[]
    readonly pushBookmarks: readonly string[]
    readonly rebaseBookmarks: readonly string[]
    readonly abandonBookmarks: readonly string[]
    readonly closePrNumbers: readonly number[]
    readonly applyCommand: string
}
