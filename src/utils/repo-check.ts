import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { execute } from "../commander/executor"
import { isStaleWorkingCopyFailure } from "./error-parser"

export interface RepoStatus {
    isJjRepo: boolean
    hasGitRepo: boolean
    /** Critical error detected at startup (e.g., stale working copy) */
    startupError: string | null
    repoPath: string
}

function getJjRoot(path: string): string | null {
    try {
        const result = spawnSync("jj", ["root"], {
            cwd: path,
            encoding: "utf-8",
            timeout: 2000,
        })
        if (result.status !== 0) return null
        const output = (result.stdout || "").trim()
        return output ? output : null
    } catch {
        return null
    }
}

export function checkRepoStatus(path: string): RepoStatus {
    const jjRoot = getJjRoot(path)
    const repoPath = jjRoot ?? path
    const isJjRepo = Boolean(jjRoot)
    const hasGitRepo = existsSync(join(repoPath, ".git"))

    // If it's a jj repo, run a quick check for critical errors
    let startupError: string | null = null
    if (isJjRepo) {
        try {
            // Run jj status synchronously to check for stale working copy
            const result = spawnSync("jj", ["status"], {
                cwd: repoPath,
                encoding: "utf-8",
                timeout: 5000,
            })
            const output = (result.stdout || "") + (result.stderr || "")
            if (
                isStaleWorkingCopyFailure({
                    exitCode: result.status ?? 1,
                    stdout: result.stdout || "",
                    stderr: result.stderr || "",
                })
            ) {
                startupError = output
            }
        } catch {
            // Ignore errors from the check itself
        }
    }

    return {
        isJjRepo,
        hasGitRepo,
        startupError,
        repoPath,
    }
}

export interface InitResult {
    success: boolean
    error?: string
}

export async function initJjRepo(path: string): Promise<InitResult> {
    const result = await execute(["git", "init"], { cwd: path })
    if (result.success) {
        return { success: true }
    }
    return {
        success: false,
        error: result.stderr.trim() || "jj git init failed",
    }
}

export async function initJjGitRepo(
    path: string,
    options: { colocate?: boolean } = {},
): Promise<InitResult> {
    const args = options.colocate
        ? ["git", "init", "--colocate"]
        : ["git", "init"]
    const result = await execute(args, { cwd: path })
    if (result.success) {
        return { success: true }
    }
    return {
        success: false,
        error: result.stderr.trim() || "jj git init failed",
    }
}
