export interface CommentLineRange {
    oldStart: number
    oldCount: number
    newStart: number
    newCount: number
}

export interface CommentEntry {
    id: string
    text: string
    author: string
    type: string
    createdAt: string
    replyTo?: string | null
}

export interface CommentAnchorHunk {
    id: string
    type: "hunk"
    filePath: string
    lineRange: CommentLineRange
    contextLines: string[]
    comments: CommentEntry[]
    stale?: boolean
}

export interface CommentAnchorLine {
    id: string
    type: "line"
    filePath: string
    lineNumber: number
    side?: "new" | "old"
    contextLines: string[]
    comments: CommentEntry[]
    stale?: boolean
}

export type CommentAnchor = CommentAnchorHunk | CommentAnchorLine

export interface RevisionComments {
    commitHash: string
    anchors: CommentAnchor[]
}

export interface CommentsState {
    version: 1
    revisions: Record<string, RevisionComments>
}
