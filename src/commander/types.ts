export interface CommitLine {
    /** Raw jj-rendered graph/gutter prefix with ANSI colors */
    gutter: string
    /** Raw jj-rendered line content after the graph/gutter with ANSI colors */
    content: string
}

export interface Commit {
    changeId: string
    commitId: string
    parentCommitIds?: string[]
    description: string
    author: string
    authorEmail: string
    timestamp: string
    lines: string[]
    /** Display lines split into sticky graph/gutter and horizontally scrollable content */
    displayLines: CommitLine[]
    /** Raw jj-rendered ref line with ANSI colors (changeId, email, date, bookmarks, etc.) */
    refLine: string
    isWorkingCopy: boolean
    immutable: boolean
    inTrunk: boolean
    empty: boolean
    divergent: boolean
    conflict: boolean
    bookmarks: string[]
    gitHead: boolean
    workingCopies: string[]
}

export function getRevisionId(commit: Commit): string {
    return commit.divergent ? commit.commitId : commit.changeId
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied"

export interface FileChange {
    path: string
    status: FileStatus
    /** Original path for renamed/copied files */
    oldPath?: string
    isBinary?: boolean
}
