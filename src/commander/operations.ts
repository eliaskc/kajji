import { type ExecuteResult, execute } from "./executor"

export interface OperationResult extends ExecuteResult {
	command: string
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

export async function jjEdit(revision: string): Promise<OperationResult> {
	const args = ["edit", revision]
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
		'description ++ "\\n"',
	])

	if (!result.success) {
		return { subject: "", body: "" }
	}

	const description = result.stdout.trim()
	const lines = description.split("\n")
	const subject = lines[0] || ""
	const body = lines.slice(1).join("\n").trim()

	return { subject, body }
}

export async function jjAbandon(revision: string): Promise<OperationResult> {
	const args = ["abandon", revision]
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
	if (!result.success) {
		throw new Error(`jj op log failed: ${result.stderr}`)
	}
	return result.stdout.split("\n")
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
