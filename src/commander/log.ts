import { execute, executeStreaming } from "./executor"
import type { ExecuteResult } from "./executor"
import type { Commit } from "./types"

const MARKER = "__LJ__"

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

function buildTemplate(): string {
	const styledDescription = `if(empty, label("empty", "(empty) "), "") ++ if(description.first_line(), description.first_line(), label("description placeholder", "(no description set)"))`

	const prefix = [
		`"${MARKER}"`,
		"change_id.short()",
		`"${MARKER}"`,
		"commit_id.short()",
		`"${MARKER}"`,
		"immutable",
		`"${MARKER}"`,
		"empty",
		`"${MARKER}"`,
		"divergent",
		`"${MARKER}"`,
		styledDescription,
		`"${MARKER}"`,
		"author.name()",
		`"${MARKER}"`,
		"author.email()",
		`"${MARKER}"`,
		'author.timestamp().local().format("%Y-%m-%d %H:%M:%S %:z")',
		`"${MARKER}"`,
		'bookmarks.map(|b| b.name()).join(",")',
		`"${MARKER}"`,
		"git_head",
		`"${MARKER}"`,
		'working_copies.map(|wc| wc.name()).join(",")',
		`"${MARKER}"`,
	].join(" ++ ")

	return `${prefix} ++ builtin_log_compact`
}

export function parseLogOutput(output: string): Commit[] {
	const commits: Commit[] = []
	let current: Commit | null = null

	for (const line of output.split("\n")) {
		if (line.includes(MARKER)) {
			const parts = line.split(MARKER)
			if (parts.length >= 14) {
				if (current) {
					commits.push(current)
				}

				const gutter = parts[0] ?? ""
				const bookmarksRaw = stripAnsi(parts[10] ?? "")
				const workingCopiesRaw = stripAnsi(parts[12] ?? "")
				current = {
					changeId: stripAnsi(parts[1] ?? ""),
					commitId: stripAnsi(parts[2] ?? ""),
					immutable: stripAnsi(parts[3] ?? "") === "true",
					empty: stripAnsi(parts[4] ?? "") === "true",
					divergent: stripAnsi(parts[5] ?? "") === "true",
					description: stripAnsi(parts[6] ?? ""),
					author: stripAnsi(parts[7] ?? ""),
					authorEmail: stripAnsi(parts[8] ?? ""),
					timestamp: stripAnsi(parts[9] ?? ""),
					bookmarks: bookmarksRaw ? bookmarksRaw.split(",") : [],
					gitHead: stripAnsi(parts[11] ?? "") === "true",
					workingCopies: workingCopiesRaw ? workingCopiesRaw.split(",") : [],
					isWorkingCopy: gutter.includes("@"),
					refLine: parts[13] ?? "",
					lines: [gutter + (parts[13] ?? "")],
				}
				continue
			}
		}

		if (current && line.trim() !== "") {
			current.lines.push(line)
		}
	}

	if (current) {
		commits.push(current)
	}

	return commits
}

interface LogStreamState {
	buffer: string
	current: Commit | null
}

function parseLogLine(line: string, state: LogStreamState): Commit | null {
	if (line.includes(MARKER)) {
		const parts = line.split(MARKER)
		if (parts.length >= 14) {
			const completed = state.current
			const gutter = parts[0] ?? ""
			const bookmarksRaw = stripAnsi(parts[10] ?? "")
			const workingCopiesRaw = stripAnsi(parts[12] ?? "")
			state.current = {
				changeId: stripAnsi(parts[1] ?? ""),
				commitId: stripAnsi(parts[2] ?? ""),
				immutable: stripAnsi(parts[3] ?? "") === "true",
				empty: stripAnsi(parts[4] ?? "") === "true",
				divergent: stripAnsi(parts[5] ?? "") === "true",
				description: stripAnsi(parts[6] ?? ""),
				author: stripAnsi(parts[7] ?? ""),
				authorEmail: stripAnsi(parts[8] ?? ""),
				timestamp: stripAnsi(parts[9] ?? ""),
				bookmarks: bookmarksRaw ? bookmarksRaw.split(",") : [],
				gitHead: stripAnsi(parts[11] ?? "") === "true",
				workingCopies: workingCopiesRaw ? workingCopiesRaw.split(",") : [],
				isWorkingCopy: gutter.includes("@"),
				refLine: parts[13] ?? "",
				lines: [gutter + (parts[13] ?? "")],
			}
			return completed
		}
	}

	if (state.current && line.trim() !== "") {
		state.current.lines.push(line)
	}

	return null
}

function consumeLogChunk(chunk: string, state: LogStreamState): Commit[] {
	state.buffer += chunk
	const lines = state.buffer.split("\n")
	state.buffer = lines.pop() ?? ""

	const completed: Commit[] = []
	for (const line of lines) {
		const finished = parseLogLine(line, state)
		if (finished) completed.push(finished)
	}

	return completed
}

function finalizeLogStream(state: LogStreamState): Commit[] {
	const completed: Commit[] = []
	if (state.buffer) {
		const finished = parseLogLine(state.buffer, state)
		if (finished) completed.push(finished)
		state.buffer = ""
	}
	if (state.current) {
		completed.push(state.current)
		state.current = null
	}
	return completed
}

export interface FetchLogOptions {
	cwd?: string
	revset?: string
	limit?: number
}

export interface FetchLogPageResult {
	commits: Commit[]
	hasMore: boolean
}

export interface StreamLogPageCallbacks {
	onBatch: (commits: Commit[]) => void
	onComplete: (result: FetchLogPageResult) => void
	onError: (error: Error) => void
}

function buildArgs(
	options: FetchLogOptions | undefined,
	template: string,
	limit?: number,
) {
	const args = ["log", "--color", "always", "--template", template]

	if (options?.revset) {
		args.push("-r", options.revset)
	}

	if (limit) {
		args.push("--limit", String(limit))
	}

	return args
}

async function executeLog(
	options: FetchLogOptions | undefined,
	limit?: number,
): Promise<string> {
	const template = buildTemplate()
	const args = buildArgs(options, template, limit)
	const result = await execute(args, {
		cwd: options?.cwd,
	})

	// Check for critical errors in both stdout and stderr (jj sometimes outputs errors to stdout)
	const combinedOutput = result.stdout + result.stderr
	if (/working copy is stale|stale working copy/i.test(combinedOutput)) {
		throw new Error(`The working copy is stale\n${combinedOutput}`)
	}

	if (!result.success) {
		throw new Error(`jj log failed: ${result.stderr}`)
	}

	return result.stdout
}

export async function fetchLogPage(
	options?: FetchLogOptions,
): Promise<FetchLogPageResult> {
	const limit = options?.limit
	const raw = await executeLog(options, limit ? limit + 1 : undefined)
	const commits = parseLogOutput(raw)

	if (!limit) {
		return { commits, hasMore: false }
	}

	if (commits.length > limit) {
		return { commits: commits.slice(0, limit), hasMore: true }
	}

	return { commits, hasMore: false }
}

export function streamLogPage(
	options: FetchLogOptions | undefined,
	callbacks: StreamLogPageCallbacks,
): { cancel: () => void } {
	const limit = options?.limit
	const template = buildTemplate()
	const args = buildArgs(options, template, limit ? limit + 1 : undefined)
	const state: LogStreamState = { buffer: "", current: null }
	const commits: Commit[] = []
	const maxCommits = limit ? limit + 1 : Number.POSITIVE_INFINITY

	let pending = false
	let flushTimer: ReturnType<typeof setTimeout> | null = null

	const flush = () => {
		flushTimer = null
		if (!pending) return
		pending = false
		const visible = limit ? commits.slice(0, limit) : commits
		callbacks.onBatch(visible)
	}

	const scheduleFlush = () => {
		if (!flushTimer) {
			flushTimer = setTimeout(flush, 25)
		}
	}

	const appendCommits = (newCommits: Commit[]) => {
		if (newCommits.length === 0) return
		let appended = false
		for (const commit of newCommits) {
			if (commits.length >= maxCommits) continue
			commits.push(commit)
			appended = true
		}
		if (appended) {
			pending = true
			scheduleFlush()
		}
	}

	return executeStreaming(
		args,
		{ cwd: options?.cwd },
		{
			onChunk: (_content: string, _lineCount: number, chunk: string) => {
				appendCommits(consumeLogChunk(chunk, state))
			},
			onComplete: (result: ExecuteResult) => {
				if (flushTimer) {
					clearTimeout(flushTimer)
					flushTimer = null
				}
				const combinedOutput = result.stdout + result.stderr
				if (/working copy is stale|stale working copy/i.test(combinedOutput)) {
					callbacks.onError(
						new Error(`The working copy is stale\n${combinedOutput}`),
					)
					return
				}
				if (!result.success) {
					callbacks.onError(new Error(`jj log failed: ${result.stderr}`))
					return
				}

				appendCommits(finalizeLogStream(state))
				const hasMore = limit ? commits.length > limit : false
				const visible = limit ? commits.slice(0, limit) : commits
				callbacks.onComplete({ commits: visible, hasMore })
			},
			onError: (error) => {
				if (flushTimer) {
					clearTimeout(flushTimer)
					flushTimer = null
				}
				callbacks.onError(error)
			},
		},
	)
}

export async function fetchLog(options?: FetchLogOptions): Promise<Commit[]> {
	const result = await fetchLogPage(options)
	return result.commits
}
