import { execute, executeStreaming } from "./executor"
import type { OperationResult } from "./operations"

export interface Bookmark {
	name: string
	changeId: string
	commitId: string
	description: string
	isLocal: boolean
	remote?: string
}

export interface FetchBookmarksOptions {
	cwd?: string
	allRemotes?: boolean
}

export async function fetchBookmarks(
	options: FetchBookmarksOptions = {},
): Promise<Bookmark[]> {
	const args = ["bookmark", "list", "--sort", "committer-date-"]

	if (options.allRemotes) {
		args.push("--all-remotes")
	}

	const result = await execute(args, { cwd: options.cwd })

	// Check for critical errors in both stdout and stderr (jj sometimes outputs errors to stdout)
	const combinedOutput = result.stdout + result.stderr
	if (/working copy is stale|stale working copy/i.test(combinedOutput)) {
		throw new Error(`The working copy is stale\n${combinedOutput}`)
	}

	if (!result.success) {
		throw new Error(`jj bookmark list failed: ${result.stderr}`)
	}

	return parseBookmarkOutput(result.stdout)
}

export interface BookmarkStreamCallbacks {
	onBatch: (bookmarks: Bookmark[], total: number) => void
	onComplete: (bookmarks: Bookmark[]) => void
	onError: (error: Error) => void
}

export function fetchBookmarksStream(
	options: FetchBookmarksOptions,
	callbacks: BookmarkStreamCallbacks,
): { cancel: () => void } {
	const args = ["bookmark", "list", "--sort", "committer-date-"]
	if (options.allRemotes) {
		args.push("--all-remotes")
	}

	let lastCount = 0

	return executeStreaming(
		args,
		{ cwd: options.cwd },
		{
			onChunk: (content, lineCount, _chunk) => {
				const parsed = parseBookmarkOutput(content)
				// Only emit if we have new bookmarks
				if (parsed.length > lastCount) {
					lastCount = parsed.length
					callbacks.onBatch(parsed, parsed.length)
				}
			},
			onComplete: (result) => {
				const combinedOutput = result.stdout + result.stderr
				if (/working copy is stale|stale working copy/i.test(combinedOutput)) {
					callbacks.onError(
						new Error(`The working copy is stale\n${combinedOutput}`),
					)
					return
				}

				if (!result.success) {
					callbacks.onError(
						new Error(`jj bookmark list failed: ${result.stderr}`),
					)
					return
				}

				const final = parseBookmarkOutput(result.stdout)
				callbacks.onComplete(final)
			},
			onError: callbacks.onError,
		},
	)
}

export function parseBookmarkOutput(output: string): Bookmark[] {
	const bookmarks: Bookmark[] = []
	const lines = output.split("\n")

	for (const line of lines) {
		if (!line.trim()) continue

		const isRemote = line.startsWith("  @")

		if (isRemote) {
			const match = line.match(/^\s+@(\S+):\s+(\S+)\s+(\S+)\s*(.*)$/)
			if (match) {
				bookmarks.push({
					name: match[1] ?? "",
					changeId: match[2] ?? "",
					commitId: match[3] ?? "",
					description: match[4]?.trim() ?? "",
					isLocal: false,
					remote: match[1],
				})
			}
		} else {
			const match = line.match(/^(\S+):\s+(\S+)\s+(\S+)\s*(.*)$/)
			if (match) {
				bookmarks.push({
					name: match[1] ?? "",
					changeId: match[2] ?? "",
					commitId: match[3] ?? "",
					description: match[4]?.trim() ?? "",
					isLocal: true,
				})
			}
		}
	}

	return bookmarks
}

export async function jjBookmarkCreate(
	name: string,
	options?: { revision?: string },
): Promise<OperationResult> {
	const args = ["bookmark", "create", name]
	if (options?.revision) {
		args.push("-r", options.revision)
	}
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjBookmarkDelete(name: string): Promise<OperationResult> {
	const args = ["bookmark", "delete", name]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjBookmarkRename(
	oldName: string,
	newName: string,
): Promise<OperationResult> {
	const args = ["bookmark", "rename", oldName, newName]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjBookmarkForget(name: string): Promise<OperationResult> {
	const args = ["bookmark", "forget", name]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjBookmarkSet(
	name: string,
	revision: string,
): Promise<OperationResult> {
	const args = ["bookmark", "set", name, "-r", revision]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}
