import { getRepoPath } from "../repo"
import type { OperationResult } from "./operations"

export async function ghPrCreateWeb(head: string): Promise<OperationResult> {
	const args = ["pr", "create", "--web", "--head", head]

	try {
		const proc = Bun.spawn(["gh", ...args], {
			cwd: getRepoPath(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		})

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])
		const exitCode = await proc.exited

		return {
			stdout,
			stderr,
			exitCode,
			success: exitCode === 0,
			command: `gh ${args.join(" ")}`,
		}
	} catch (error) {
		return {
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			exitCode: 1,
			success: false,
			command: `gh ${args.join(" ")}`,
		}
	}
}

export async function ghBrowseCommit(commit: string): Promise<OperationResult> {
	const args = ["browse", commit]

	try {
		const proc = Bun.spawn(["gh", ...args], {
			cwd: getRepoPath(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		})

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])
		const exitCode = await proc.exited

		return {
			stdout,
			stderr,
			exitCode,
			success: exitCode === 0,
			command: `gh ${args.join(" ")}`,
		}
	} catch (error) {
		return {
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			exitCode: 1,
			success: false,
			command: `gh ${args.join(" ")}`,
		}
	}
}
