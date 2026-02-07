import { execute, executeStreaming, executeWithColor } from "./executor"
import type { OperationResult } from "./operations"

const BOOKMARK_MARKER = "__BJ__"
const BOOKMARK_DESCRIPTION =
	'if(normal_target, if(normal_target.empty(), label("empty", "(empty) "), "") ++ if(normal_target.description().first_line(), normal_target.description().first_line(), label("description placeholder", "(no description set)")), "")'

const BOOKMARK_TEMPLATE = [
	`"${BOOKMARK_MARKER}"`,
	"name",
	`"${BOOKMARK_MARKER}"`,
	'label("bookmark name", name)',
	`"${BOOKMARK_MARKER}"`,
	'if(remote, remote, "")',
	`"${BOOKMARK_MARKER}"`,
	'pad_end(8, truncate_end(8, coalesce(if(normal_target, format_short_change_id(normal_target.change_id()), ""), self.added_targets().map(|c| format_short_change_id(c.change_id())).join(","), self.removed_targets().map(|c| format_short_change_id(c.change_id())).join(","))))',
	`"${BOOKMARK_MARKER}"`,
	'coalesce(if(normal_target, format_short_commit_id(normal_target.commit_id()), ""), self.added_targets().map(|c| format_short_commit_id(c.commit_id())).join(","), self.removed_targets().map(|c| format_short_commit_id(c.commit_id())).join(","))',
	`"${BOOKMARK_MARKER}"`,
	'coalesce(if(normal_target, normal_target.change_id(), ""), self.added_targets().map(|c| c.change_id()).join(","), self.removed_targets().map(|c| c.change_id()).join(","))',
	`"${BOOKMARK_MARKER}"`,
	'coalesce(if(normal_target, normal_target.commit_id(), ""), self.added_targets().map(|c| c.commit_id()).join(","), self.removed_targets().map(|c| c.commit_id()).join(","))',
	`"${BOOKMARK_MARKER}"`,
	`coalesce(${BOOKMARK_DESCRIPTION}, self.added_targets().map(|c| if(c.empty(), label("empty", "(empty) "), "") ++ if(c.description().first_line(), c.description().first_line(), label("description placeholder", "(no description set)"))).join(", "), self.removed_targets().map(|c| if(c.empty(), label("empty", "(empty) "), "") ++ if(c.description().first_line(), c.description().first_line(), label("description placeholder", "(no description set)"))).join(", "))`,
	'"\\n"',
].join(" ++ ")

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

export interface Bookmark {
	name: string
	nameDisplay: string
	changeId: string
	commitId: string
	changeIdDisplay: string
	commitIdDisplay: string
	descriptionDisplay: string
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
	const args = [
		"bookmark",
		"list",
		"--sort",
		"committer-date-",
		"--template",
		BOOKMARK_TEMPLATE,
	]

	if (options.allRemotes) {
		args.push("--all-remotes")
	}

	const result = await executeWithColor(args, { cwd: options.cwd })

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
	const args = [
		"--color",
		"always",
		"bookmark",
		"list",
		"--sort",
		"committer-date-",
		"--template",
		BOOKMARK_TEMPLATE,
	]
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
		if (!line.includes(BOOKMARK_MARKER)) continue
		const parts = line.split(BOOKMARK_MARKER)
		if (parts.length < 9) continue

		const name = stripAnsi(parts[1] ?? "")
		const nameDisplay = parts[2] ?? ""
		const remote = stripAnsi(parts[3] ?? "")
		const changeIdDisplay = parts[4] ?? ""
		const commitIdDisplay = parts[5] ?? ""
		const changeId = stripAnsi(parts[6] ?? "")
		const commitId = stripAnsi(parts[7] ?? "")
		const descriptionDisplay = parts[8] ?? ""
		const description = stripAnsi(descriptionDisplay).trim()
		const isLocal = remote.length === 0

		bookmarks.push({
			name,
			nameDisplay,
			changeId,
			commitId,
			changeIdDisplay,
			commitIdDisplay,
			descriptionDisplay,
			description,
			isLocal,
			remote: isLocal ? undefined : remote,
		})
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

export async function fetchNearestAncestorBookmarkNames(
	revision: string,
): Promise<string[]> {
	const revset = `heads(::${revision} & bookmarks())`
	const args = ["bookmark", "list", "-r", revset, "--template", 'name ++ "\\n"']
	const result = await execute(args)
	if (!result.success) {
		throw new Error(`jj bookmark list failed: ${result.stderr}`)
	}
	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
}
