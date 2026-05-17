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
