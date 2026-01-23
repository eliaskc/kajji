import { getRepoPath } from "../repo"
import { profile, profileMsg } from "../utils/profiler"

export interface ExecuteResult {
	stdout: string
	stderr: string
	exitCode: number
	success: boolean
}

export interface ExecuteOptions {
	cwd?: string
	env?: Record<string, string>
	timeout?: number
}

export async function execute(
	args: string[],
	options: ExecuteOptions = {},
): Promise<ExecuteResult> {
	const endTotal = profile(`execute [jj ${args[0]}]`)
	const endSpawn = profile("  spawn")

	const proc = Bun.spawn(["jj", ...args], {
		cwd: options.cwd || getRepoPath(),
		env: {
			...process.env,
			// Prevent jj from opening editors
			JJ_EDITOR: "true",
			EDITOR: "true",
			VISUAL: "true",
			...options.env,
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})
	endSpawn()

	const endRead = profile("  read stdout/stderr")
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])
	endRead(`${stdout.length} chars, ${stdout.split("\n").length} lines`)

	const endWait = profile("  wait for exit")
	const exitCode = await proc.exited
	endWait()

	endTotal()

	return {
		stdout,
		stderr,
		exitCode,
		success: exitCode === 0,
	}
}

export async function executeWithColor(
	args: string[],
	options: ExecuteOptions = {},
): Promise<ExecuteResult> {
	return execute(["--color", "always", ...args], options)
}

export interface StreamingExecuteCallbacks {
	onChunk: (content: string, lineCount: number) => void
	onComplete: (result: ExecuteResult) => void
	onError: (error: Error) => void
}

export function executeStreaming(
	args: string[],
	options: ExecuteOptions,
	callbacks: StreamingExecuteCallbacks,
): { cancel: () => void } {
	const endTotal = profile(`executeStreaming [jj ${args[0]}]`)

	const proc = Bun.spawn(["jj", ...args], {
		cwd: options.cwd || getRepoPath(),
		env: {
			...process.env,
			JJ_EDITOR: "true",
			EDITOR: "true",
			VISUAL: "true",
			...options.env,
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})

	let cancelled = false
	let stdout = ""
	let lineCount = 0

	const readStream = async () => {
		try {
			const reader = proc.stdout.getReader()
			const decoder = new TextDecoder()
			let chunkCount = 0

			while (!cancelled) {
				const { done, value } = await reader.read()
				if (done) break

				chunkCount++
				const chunk = decoder.decode(value, { stream: true })
				stdout += chunk

				const newLines = chunk.split("\n").length - 1
				lineCount += newLines

				profileMsg(
					`  chunk #${chunkCount}: ${chunk.length} bytes, ${newLines} lines, total ${lineCount} lines`,
				)

				callbacks.onChunk(stdout, lineCount)

				await new Promise((r) => setImmediate(r))
			}

			const stderr = await new Response(proc.stderr).text()
			const exitCode = await proc.exited

			endTotal()

			if (!cancelled) {
				callbacks.onComplete({
					stdout,
					stderr,
					exitCode,
					success: exitCode === 0,
				})
			}
		} catch (error) {
			if (!cancelled) {
				callbacks.onError(
					error instanceof Error ? error : new Error(String(error)),
				)
			}
		}
	}

	readStream()

	return {
		cancel: () => {
			cancelled = true
			proc.kill()
		},
	}
}

