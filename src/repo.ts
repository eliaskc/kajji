import { resolve } from "node:path"

let repoPath: string = process.cwd()

export function getRepoPath(): string {
	return repoPath
}

export function setRepoPath(path: string): void {
	repoPath = resolve(path)
}
