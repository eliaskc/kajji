import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { writeFileAtomic } from "../utils/atomic-write"
import type { CommentsState } from "./types"

const COMMENTS_VERSION = 1
const STATE_DIR = join(homedir(), ".local", "state", "kajji")
const REPOS_DIR = join(STATE_DIR, "repos")

function hashRepoPath(path: string): string {
    return createHash("sha256").update(path).digest("hex")
}

function getCommentsPath(repoRoot: string): string {
    return join(REPOS_DIR, hashRepoPath(repoRoot), "comments.json")
}

export function readComments(repoRoot: string): CommentsState {
    const commentsPath = getCommentsPath(repoRoot)
    if (!existsSync(commentsPath)) {
        return { version: COMMENTS_VERSION, revisions: {} }
    }
    try {
        const content = readFileSync(commentsPath, "utf-8")
        const parsed = JSON.parse(content) as CommentsState
        if (parsed && parsed.version === COMMENTS_VERSION) {
            return parsed
        }
        return { version: COMMENTS_VERSION, revisions: {} }
    } catch {
        return { version: COMMENTS_VERSION, revisions: {} }
    }
}

export function writeComments(repoRoot: string, state: CommentsState): void {
    const commentsPath = getCommentsPath(repoRoot)
    writeFileAtomic(commentsPath, JSON.stringify(state, null, 2))
}
