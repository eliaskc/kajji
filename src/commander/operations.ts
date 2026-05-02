import { HookError, runPreHooks } from "../hooks/runner"
import { getRepoPath } from "../repo"
import { type ExecuteResult, execute } from "./executor"
import type { OperationRunOptions } from "./observer"

export interface OperationResult extends ExecuteResult {
	command: string
}

export interface InteractiveOptions {
	cwd?: string
	ignoreImmutable?: boolean
}

export async function jjSplitInteractive(
	revision: string,
	options?: InteractiveOptions,
): Promise<{ success: boolean; error?: string }> {
	const args = ["split", "-r", revision]
	if (options?.ignoreImmutable) {
		args.push("--ignore-immutable")
	}
	const cwd = options?.cwd ?? getRepoPath()

	const proc = Bun.spawn(["jj", ...args], {
		cwd,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})

	const exitCode = await proc.exited
	return {
		success: exitCode === 0,
		error: exitCode !== 0 ? `jj split exited with code ${exitCode}` : undefined,
	}
}

export interface OpLogEntry {
	operationId: string
	lines: string[]
	isCurrent: boolean
}

export interface RefreshState {
	operationId: string
	workingCopyCommitId: string
}

function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence
	return str.replace(/\x1b\[[0-9;]*m/g, "")
}

function throwIfStaleWorkingCopy(result: ExecuteResult): void {
	const combinedOutput = result.stdout + result.stderr
	if (/working copy is stale|stale working copy/i.test(combinedOutput)) {
		throw new Error(`The working copy is stale\n${combinedOutput}`)
	}
}

export function parseOpLog(lines: string[]): OpLogEntry[] {
	const operations: OpLogEntry[] = []
	let current: OpLogEntry | null = null

	for (const line of lines) {
		const stripped = stripAnsi(line)
		const isHeader = stripped.startsWith("@") || stripped.startsWith("○")

		if (isHeader) {
			if (current) {
				operations.push(current)
			}
			const parts = stripped.split(/\s+/)
			const operationId = parts[1] || ""
			current = {
				operationId,
				lines: [line],
				isCurrent: stripped.startsWith("@"),
			}
		} else if (current && stripped.trim()) {
			current.lines.push(line)
		}
	}

	if (current) {
		operations.push(current)
	}

	return operations
}

export interface VerifyOptions extends OperationRunOptions {
	verify?: boolean
}
async function runJjNewWithHooks(
	args: string[],
	options?: VerifyOptions,
): Promise<OperationResult> {
	try {
		await runPreHooks("jj.new", options)
	} catch (error) {
		if (error instanceof HookError) {
			options?.observer?.skip("jj new skipped because pre-hook failed")
			return {
				...error.result,
				command: `hook jj.new: ${error.command}`,
			}
		}
		throw error
	}

	const result = await execute(args, {
		observer: options?.observer,
		command: `jj ${args.join(" ")}`,
	})
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjNew(
	revision: string,
	options?: VerifyOptions,
): Promise<OperationResult> {
	return runJjNewWithHooks(["new", revision], options)
}

export async function jjNewBefore(
	revision: string,
	options?: VerifyOptions,
): Promise<OperationResult> {
	return runJjNewWithHooks(["new", "-B", revision], options)
}

export async function jjNewAfter(
	revision: string,
	options?: VerifyOptions,
): Promise<OperationResult> {
	return runJjNewWithHooks(["new", "-A", revision], options)
}

export async function jjDuplicate(revision: string): Promise<OperationResult> {
	const args = ["duplicate", revision]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjResolveInteractive(options?: {
	revision?: string
	paths?: string[]
	tool?: string
	cwd?: string
}): Promise<{ success: boolean; error?: string }> {
	const args = ["resolve"]
	if (options?.revision) {
		args.push("-r", options.revision)
	}
	if (options?.tool) {
		args.push("--tool", options.tool)
	}
	if (options?.paths?.length) {
		args.push(...options.paths)
	}

	const cwd = options?.cwd ?? getRepoPath()
	const proc = Bun.spawn(["jj", ...args], {
		cwd,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})

	const exitCode = await proc.exited
	return {
		success: exitCode === 0,
		error:
			exitCode !== 0 ? `jj resolve exited with code ${exitCode}` : undefined,
	}
}

export async function jjEdit(
	revision: string,
	options?: { ignoreImmutable?: boolean },
): Promise<OperationResult> {
	const args = ["edit", revision]
	if (options?.ignoreImmutable) {
		args.push("--ignore-immutable")
	}
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export interface SquashOptions {
	into?: string
	useDestinationMessage?: boolean
	keepEmptied?: boolean
	ignoreImmutable?: boolean
}

export async function jjSquash(
	revision?: string,
	options?: SquashOptions,
): Promise<OperationResult> {
	const args = ["squash"]

	// Use --from when squashing into a specific target, -r otherwise
	if (options?.into) {
		if (revision) {
			args.push("--from", revision)
		}
		args.push("--into", options.into)
	} else if (revision) {
		args.push("-r", revision)
	}

	if (options?.useDestinationMessage) {
		args.push("-u")
	}
	if (options?.keepEmptied) {
		args.push("-k")
	}
	if (options?.ignoreImmutable) {
		args.push("--ignore-immutable")
	}

	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjSquashInteractive(
	revision: string,
	options?: SquashOptions & { cwd?: string },
): Promise<{ success: boolean; error?: string }> {
	const args = ["squash", "-i"]

	if (options?.into) {
		args.push("--from", revision, "--into", options.into)
	} else {
		args.push("-r", revision)
	}

	if (options?.useDestinationMessage) {
		args.push("-u")
	}
	if (options?.keepEmptied) {
		args.push("-k")
	}
	if (options?.ignoreImmutable) {
		args.push("--ignore-immutable")
	}

	const cwd = options?.cwd ?? getRepoPath()

	const proc = Bun.spawn(["jj", ...args], {
		cwd,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})

	const exitCode = await proc.exited
	return {
		success: exitCode === 0,
		error:
			exitCode !== 0 ? `jj squash -i exited with code ${exitCode}` : undefined,
	}
}

export function isImmutableError(result: OperationResult): boolean {
	return (
		!result.success &&
		(result.stderr.includes("immutable") || result.stderr.includes("Immutable"))
	)
}

export interface RebaseOptions {
	mode?: "revision" | "descendants" | "branch"
	targetMode?: "onto" | "insertAfter" | "insertBefore"
	skipEmptied?: boolean
	ignoreImmutable?: boolean
}

export async function jjRebase(
	revision: string,
	destination: string,
	options?: RebaseOptions,
): Promise<OperationResult> {
	const args = ["rebase"]
	const mode = options?.mode ?? "revision"
	const targetMode = options?.targetMode ?? "onto"

	if (mode === "descendants") {
		args.push("-s", revision)
	} else if (mode === "branch") {
		args.push("-b", revision)
	} else {
		args.push("-r", revision)
	}

	if (targetMode === "insertAfter") {
		args.push("-A", destination)
	} else if (targetMode === "insertBefore") {
		args.push("-B", destination)
	} else {
		args.push("-d", destination)
	}

	if (options?.skipEmptied) {
		args.push("--skip-emptied")
	}
	if (options?.ignoreImmutable) {
		args.push("--ignore-immutable")
	}
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjDescribe(
	revision: string,
	message: string,
	options?: { ignoreImmutable?: boolean },
): Promise<OperationResult> {
	const args = ["describe", revision, "-m", message]
	if (options?.ignoreImmutable) {
		args.push("--ignore-immutable")
	}
	const result = await execute(args)
	return {
		...result,
		command: `jj describe ${revision} -m "..."`,
	}
}

export async function jjShowDescription(
	revision: string,
): Promise<{ subject: string; body: string }> {
	const result = await execute([
		"log",
		"-r",
		revision,
		"--no-graph",
		"-T",
		"description",
	])

	if (!result.success) {
		return { subject: "", body: "" }
	}

	const description = result.stdout.trim()
	const lines = description.split("\n")
	const subject = lines[0] ?? ""
	const body = lines.slice(1).join("\n").trim()

	return { subject, body }
}

export async function jjShowDescriptionStyled(
	revision: string,
): Promise<{ subject: string; body: string }> {
	const styledTemplate = `if(empty, label("empty", "(empty) "), "") ++ if(description.first_line(), description.first_line(), label("description placeholder", "(no description set)"))`

	const [subjectResult, descResult] = await Promise.all([
		execute([
			"log",
			"-r",
			revision,
			"--no-graph",
			"--color",
			"always",
			"-T",
			styledTemplate,
		]),
		execute(["log", "-r", revision, "--no-graph", "-T", "description"]),
	])

	const subject = subjectResult.success ? subjectResult.stdout.trim() : ""

	let body = ""
	if (descResult.success) {
		const lines = descResult.stdout.trim().split("\n")
		body = lines.slice(1).join("\n").trim()
	}

	return { subject, body }
}

export async function jjAbandon(
	revision: string,
	options?: { ignoreImmutable?: boolean },
): Promise<OperationResult> {
	const args = ["abandon", revision]
	if (options?.ignoreImmutable) {
		args.push("--ignore-immutable")
	}
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function fetchOpLog(limit?: number): Promise<string[]> {
	const args = ["op", "log", "--color", "always", "--ignore-working-copy"]
	if (limit) {
		args.push("--limit", String(limit))
	}
	const result = await execute(args)
	throwIfStaleWorkingCopy(result)

	if (!result.success) {
		throw new Error(`jj op log failed: ${result.stderr}`)
	}
	return result.stdout.split("\n")
}

export async function fetchOpLogId(): Promise<string> {
	const result = await execute([
		"op",
		"log",
		"--limit",
		"1",
		"--no-graph",
		"--ignore-working-copy",
		"-T",
		"self.id()",
	])
	throwIfStaleWorkingCopy(result)

	if (!result.success) {
		return ""
	}
	return result.stdout.trim()
}

export async function fetchWorkingCopyCommitId(): Promise<string> {
	const result = await execute([
		"log",
		"--limit",
		"1",
		"--no-graph",
		"-r",
		"@",
		"-T",
		"commit_id",
	])
	throwIfStaleWorkingCopy(result)

	if (!result.success) {
		return ""
	}

	return stripAnsi(result.stdout).trim()
}

export async function fetchRefreshState(): Promise<RefreshState> {
	const [operationId, workingCopyCommitId] = await Promise.all([
		fetchOpLogId(),
		fetchWorkingCopyCommitId(),
	])

	return {
		operationId,
		workingCopyCommitId,
	}
}

export async function jjUndo(): Promise<OperationResult> {
	const args = ["undo"]
	const result = await execute(args)
	return {
		...result,
		command: "jj undo",
	}
}

export async function jjRedo(): Promise<OperationResult> {
	const args = ["redo"]
	const result = await execute(args)
	return {
		...result,
		command: "jj redo",
	}
}

export async function jjOpRestore(
	operationId: string,
): Promise<OperationResult> {
	const args = ["op", "restore", operationId]
	const result = await execute(args)
	return {
		...result,
		command: `jj op restore ${operationId}`,
	}
}

export async function jjWorkspaceUpdateStale(): Promise<OperationResult> {
	const args = ["workspace", "update-stale"]
	const result = await execute(args)
	return {
		...result,
		command: "jj workspace update-stale",
	}
}

export interface GitFetchOptions {
	allRemotes?: boolean
	tracked?: boolean
	branches?: string[]
	remotes?: string[]
}

export async function jjGitFetch(
	options?: GitFetchOptions & OperationRunOptions,
): Promise<OperationResult> {
	const args = ["git", "fetch"]
	if (options?.branches?.length) {
		for (const branch of options.branches) {
			args.push("--branch", branch)
		}
	}
	if (options?.tracked) {
		args.push("--tracked")
	}
	if (options?.remotes?.length) {
		for (const remote of options.remotes) {
			args.push("--remote", remote)
		}
	}
	if (options?.allRemotes) {
		args.push("--all-remotes")
	}
	const result = await execute(args, {
		observer: options?.observer,
		command: `jj ${args.join(" ")}`,
	})
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export interface GitPushOptions {
	remote?: string
	bookmarks?: string[]
	all?: boolean
	tracked?: boolean
	deleted?: boolean
	allowEmptyDescription?: boolean
	allowPrivate?: boolean
	revisions?: string[]
	changes?: string[]
	dryRun?: boolean
}

export async function jjGitPush(
	options?: GitPushOptions & OperationRunOptions,
): Promise<OperationResult> {
	const args = ["git", "push"]
	if (options?.remote) {
		args.push("--remote", options.remote)
	}
	if (options?.bookmarks?.length) {
		for (const bookmark of options.bookmarks) {
			args.push("--bookmark", bookmark)
		}
	}
	if (options?.all) {
		args.push("--all")
	}
	if (options?.tracked) {
		args.push("--tracked")
	}
	if (options?.deleted) {
		args.push("--deleted")
	}
	if (options?.allowEmptyDescription) {
		args.push("--allow-empty-description")
	}
	if (options?.allowPrivate) {
		args.push("--allow-private")
	}
	if (options?.revisions?.length) {
		for (const revision of options.revisions) {
			args.push("--revisions", revision)
		}
	}
	if (options?.changes?.length) {
		for (const change of options.changes) {
			args.push("--change", change)
		}
	}
	if (options?.dryRun) {
		args.push("--dry-run")
	}
	const result = await execute(args, {
		observer: options?.observer,
		command: `jj ${args.join(" ")}`,
	})
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjGitPushBookmark(
	bookmark: string,
): Promise<OperationResult> {
	const args = ["git", "push", "--bookmark", bookmark]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjGitPushChange(
	changeId: string,
): Promise<OperationResult> {
	const args = ["git", "push", "--change", changeId]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjRestore(paths: string[]): Promise<OperationResult> {
	const args = ["restore", ...paths]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjIsInTrunk(revision: string): Promise<boolean> {
	const result = await execute([
		"log",
		"-r",
		`${revision} & ::trunk()`,
		"--no-graph",
		"-T",
		"change_id",
	])

	if (!result.success) return false
	return result.stdout.trim().length > 0
}

export interface DiffStats {
	files: { path: string; insertions: number; deletions: number }[]
	totalFiles: number
	totalInsertions: number
	totalDeletions: number
}

export async function jjDiffStats(revision: string): Promise<DiffStats> {
	const result = await execute(["diff", "--stat", "-r", revision])

	if (!result.success) {
		return { files: [], totalFiles: 0, totalInsertions: 0, totalDeletions: 0 }
	}

	return parseDiffStats(result.stdout)
}

function parseDiffStats(output: string): DiffStats {
	const lines = output.trim().split("\n")
	const files: DiffStats["files"] = []
	let totalFiles = 0
	let totalInsertions = 0
	let totalDeletions = 0

	for (const line of lines) {
		// Summary line: "14 files changed, 1448 insertions(+), 56 deletions(-)"
		const summaryMatch = line.match(
			/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
		)
		if (summaryMatch) {
			totalFiles = Number.parseInt(summaryMatch[1] ?? "0", 10)
			totalInsertions = summaryMatch[2]
				? Number.parseInt(summaryMatch[2], 10)
				: 0
			totalDeletions = summaryMatch[3]
				? Number.parseInt(summaryMatch[3], 10)
				: 0
			continue
		}

		// File line: "src/foo.ts | 12 ++++----"
		const fileMatch = line.match(/^(.+?)\s+\|\s+(\d+)\s+([+-]*)/)
		if (fileMatch) {
			const path = (fileMatch[1] ?? "").trim()
			const plusCount = (fileMatch[3]?.match(/\+/g) || []).length
			const minusCount = (fileMatch[3]?.match(/-/g) || []).length
			files.push({ path, insertions: plusCount, deletions: minusCount })
		}
	}

	return { files, totalFiles, totalInsertions, totalDeletions }
}

/**
 * Fetch commit details (description only, no stats).
 * Stats are computed from the already-fetched diff in MainArea.tsx to avoid redundant jj calls.
 */
export interface CommitDetailsResult {
	subject: string
	body: string
}

const DETAILS_SEPARATOR = "\n---KAJJI_DETAILS_SEPARATOR---\n"

export async function jjCommitDetails(
	revision: string,
): Promise<CommitDetailsResult> {
	// Template: styled subject, then separator, then full description
	const styledSubjectTemplate = `if(empty, label("empty", "(empty) "), "") ++ if(description.first_line(), description.first_line(), label("description placeholder", "(no description set)"))`

	const result = await execute([
		"log",
		"-r",
		revision,
		"--no-graph",
		"--color",
		"always",
		"-T",
		`${styledSubjectTemplate} ++ "${DETAILS_SEPARATOR}" ++ description`,
	])

	if (!result.success) {
		return {
			subject: "",
			body: "",
		}
	}

	const parts = result.stdout.split(DETAILS_SEPARATOR)
	const subject = (parts[0] ?? "").trim()
	const fullDescription = (parts[1] ?? "").trim()

	// Body is everything after the first line of description
	const descLines = fullDescription.split("\n")
	const body = descLines.slice(1).join("\n").trim()

	return {
		subject,
		body,
	}
}
