import { getRepoPath } from "../repo"
import { type ExecuteResult, execute } from "./executor"

export interface OperationResult extends ExecuteResult {
	command: string
}

export interface InteractiveOptions {
	cwd?: string
}

export async function jjSplitInteractive(
	revision: string,
	options?: InteractiveOptions,
): Promise<{ success: boolean; error?: string }> {
	const args = ["split", "-r", revision]
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

function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence
	return str.replace(/\x1b\[[0-9;]*m/g, "")
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

export async function jjNew(revision: string): Promise<OperationResult> {
	const args = ["new", revision]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjNewBefore(revision: string): Promise<OperationResult> {
	const args = ["new", "-B", revision]
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
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

export async function jjSquash(
	revision?: string,
	options?: { ignoreImmutable?: boolean },
): Promise<OperationResult> {
	const args = revision ? ["squash", "-r", revision] : ["squash"]
	if (options?.ignoreImmutable) {
		args.push("--ignore-immutable")
	}
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export function isImmutableError(result: OperationResult): boolean {
	return (
		!result.success &&
		(result.stderr.includes("immutable") || result.stderr.includes("Immutable"))
	)
}

export async function jjRebase(
	revision: string,
	destination: string,
	options?: { ignoreImmutable?: boolean },
): Promise<OperationResult> {
	const args = ["rebase", "-r", revision, "-d", destination]
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
		"--ignore-working-copy",
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
			"--ignore-working-copy",
			"-T",
			styledTemplate,
		]),
		execute([
			"log",
			"-r",
			revision,
			"--no-graph",
			"--ignore-working-copy",
			"-T",
			"description",
		]),
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
	const args = ["op", "log", "--color", "always"]
	if (limit) {
		args.push("--limit", String(limit))
	}
	const result = await execute(args)

	// Check for critical errors in both stdout and stderr (jj sometimes outputs errors to stdout)
	const combinedOutput = result.stdout + result.stderr
	if (/working copy is stale|stale working copy/i.test(combinedOutput)) {
		throw new Error(`The working copy is stale\n${combinedOutput}`)
	}

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
		"-T",
		"self.id()",
	])

	// Check for critical errors in both stdout and stderr (jj sometimes outputs errors to stdout)
	const combinedOutput = result.stdout + result.stderr
	if (/working copy is stale|stale working copy/i.test(combinedOutput)) {
		throw new Error(`The working copy is stale\n${combinedOutput}`)
	}

	if (!result.success) {
		return ""
	}
	return result.stdout.trim()
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

export async function jjGitFetch(options?: {
	allRemotes?: boolean
}): Promise<OperationResult> {
	const args = ["git", "fetch"]
	if (options?.allRemotes) {
		args.push("--all-remotes")
	}
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjGitPush(options?: {
	all?: boolean
}): Promise<OperationResult> {
	const args = ["git", "push"]
	if (options?.all) {
		args.push("--all")
	}
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export async function jjRestore(
	paths: string[],
	revision?: string,
): Promise<OperationResult> {
	const args = ["restore"]
	if (revision) {
		args.push("-r", revision)
	}
	args.push(...paths)
	const result = await execute(args)
	return {
		...result,
		command: `jj ${args.join(" ")}`,
	}
}

export interface DiffStats {
	files: { path: string; insertions: number; deletions: number }[]
	totalFiles: number
	totalInsertions: number
	totalDeletions: number
}

export async function jjDiffStats(revision: string): Promise<DiffStats> {
	const result = await execute([
		"diff",
		"--stat",
		"-r",
		revision,
		"--ignore-working-copy",
	])

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
		"--ignore-working-copy",
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
