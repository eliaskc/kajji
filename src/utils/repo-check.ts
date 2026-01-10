import { existsSync } from "node:fs"
import { join } from "node:path"
import { execute } from "../commander/executor"

export interface RepoStatus {
	isJjRepo: boolean
	hasGitRepo: boolean
}

export function checkRepoStatus(path: string): RepoStatus {
	return {
		isJjRepo: existsSync(join(path, ".jj")),
		hasGitRepo: existsSync(join(path, ".git")),
	}
}

export interface InitResult {
	success: boolean
	error?: string
}

export async function initJjRepo(path: string): Promise<InitResult> {
	const result = await execute(["init"], { cwd: path })
	if (result.success) {
		return { success: true }
	}
	return { success: false, error: result.stderr.trim() || "jj init failed" }
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
