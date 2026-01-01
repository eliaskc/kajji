import { type ExecuteResult, execute } from "./executor"

export interface OperationResult extends ExecuteResult {
	command: string
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
