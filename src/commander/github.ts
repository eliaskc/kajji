import { getRepoPath } from "../repo"
import type { ExecuteResult } from "./executor"
import type { CommandObserver, OperationRunOptions } from "./observer"
import type { OperationResult } from "./operations"

async function readGhOutput(
	command: string,
	proc: ReturnType<typeof Bun.spawn>,
	observer?: CommandObserver,
): Promise<Pick<ExecuteResult, "stdout" | "stderr"> & { logId?: string }> {
	const logId = observer?.start(command, { kind: "shell" })
	let stdout = ""
	let stderr = ""

	const stdoutStream = proc.stdout as ReadableStream<Uint8Array>
	const stderrStream = proc.stderr as ReadableStream<Uint8Array>

	if (observer && logId) {
		const readStream = async (
			stream: ReadableStream<Uint8Array>,
			append: (chunk: string) => void,
		) => {
			const reader = stream.getReader()
			const decoder = new TextDecoder()
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				const chunk = decoder.decode(value, { stream: true })
				append(chunk)
				observer.append(logId, chunk)
			}
			const tail = decoder.decode()
			if (tail) {
				append(tail)
				observer.append(logId, tail)
			}
		}

		await Promise.all([
			readStream(stdoutStream, (chunk) => {
				stdout += chunk
			}),
			readStream(stderrStream, (chunk) => {
				stderr += chunk
			}),
		])
	} else {
		;[stdout, stderr] = await Promise.all([
			new Response(stdoutStream).text(),
			new Response(stderrStream).text(),
		])
	}

	return { stdout, stderr, logId }
}

function finishObservedGhCommand(
	observer: CommandObserver | undefined,
	logId: string | undefined,
	result: OperationResult,
) {
	if (logId) observer?.finish(logId, result)
}

export async function ghPrCreateWeb(
	head: string,
	options?: OperationRunOptions,
): Promise<OperationResult> {
	const args = ["pr", "create", "--web", "--head", head]
	const command = `gh ${args.join(" ")}`

	try {
		const proc = Bun.spawn(["gh", ...args], {
			cwd: getRepoPath(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		})

		const { stdout, stderr, logId } = await readGhOutput(
			command,
			proc,
			options?.observer,
		)
		const exitCode = await proc.exited
		const result = {
			stdout,
			stderr,
			exitCode,
			success: exitCode === 0,
			command,
			logged: Boolean(logId),
		}
		finishObservedGhCommand(options?.observer, logId, result)
		return result
	} catch (error) {
		return {
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			exitCode: 1,
			success: false,
			command,
		}
	}
}

export async function ghBrowseCommit(
	commit: string,
	options?: OperationRunOptions,
): Promise<OperationResult> {
	const args = ["browse", commit]
	const command = `gh ${args.join(" ")}`

	try {
		const proc = Bun.spawn(["gh", ...args], {
			cwd: getRepoPath(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		})

		const { stdout, stderr, logId } = await readGhOutput(
			command,
			proc,
			options?.observer,
		)
		const exitCode = await proc.exited
		const result = {
			stdout,
			stderr,
			exitCode,
			success: exitCode === 0,
			command,
			logged: Boolean(logId),
		}
		finishObservedGhCommand(options?.observer, logId, result)
		return result
	} catch (error) {
		return {
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			exitCode: 1,
			success: false,
			command,
		}
	}
}
