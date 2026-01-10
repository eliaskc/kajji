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

export interface PTYStreamingOptions extends ExecuteOptions {
	cols?: number
	rows?: number
}

/**
 * Execute jj command via PTY for true streaming output.
 * Uses Bun.spawn with terminal option (requires Bun 1.3.5+).
 * Falls back to regular executeStreaming on Windows or if PTY fails.
 */
export function executePTYStreaming(
	args: string[],
	options: PTYStreamingOptions,
	callbacks: StreamingExecuteCallbacks,
): { cancel: () => void } {
	const endTotal = profile(`executePTYStreaming [jj ${args[0]}]`)

	const cols = options.cols || 120
	const rows = options.rows || 50
	const cwd = options.cwd || getRepoPath()

	let cancelled = false
	let stdout = ""
	let lineCount = 0
	let chunkCount = 0
	let pendingUpdate = false
	let lastUpdateTime = 0
	const UPDATE_INTERVAL = 60
	const startTime = performance.now()

	try {
		const proc = Bun.spawn(["jj", ...args], {
			cwd,
			env: {
				...process.env,
				JJ_EDITOR: "true",
				EDITOR: "true",
				VISUAL: "true",
				...options.env,
			},
			terminal: {
				cols,
				rows,
				data(_terminal, data) {
					if (cancelled) return

					chunkCount++
					const chunk = data.toString()
					stdout += chunk

					if (chunkCount === 1) {
						const firstChunkTime = performance.now() - startTime
						profileMsg(
							`  PTY first chunk: ${firstChunkTime.toFixed(0)}ms, ${chunk.length} bytes`,
						)
					}

					let newLines = 0
					for (let i = 0; i < chunk.length; i++) {
						if (chunk[i] === "\n") newLines++
					}
					lineCount += newLines

					if (chunkCount <= 5) {
						profileMsg(
							`  PTY chunk #${chunkCount}: ${chunk.length} bytes, ${newLines} lines, total ${lineCount} lines`,
						)
					}

					const now = performance.now()
					const shouldUpdate =
						chunkCount === 1 || now - lastUpdateTime >= UPDATE_INTERVAL
					if (shouldUpdate) {
						lastUpdateTime = now
						callbacks.onChunk(stdout, lineCount)
					} else if (!pendingUpdate) {
						pendingUpdate = true
						setTimeout(() => {
							pendingUpdate = false
							if (!cancelled) {
								lastUpdateTime = performance.now()
								callbacks.onChunk(stdout, lineCount)
							}
						}, UPDATE_INTERVAL)
					}
				},
				close() {
					const closeTime = performance.now() - startTime
					profileMsg(
						`  PTY close callback: ${closeTime.toFixed(0)}ms, ${chunkCount} chunks`,
					)
				},
			},
		})

		proc.exited.then((exitCode) => {
			if (cancelled) return

			const exitTime = performance.now() - startTime
			profileMsg(
				`  PTY exited: ${exitTime.toFixed(0)}ms, ${chunkCount} chunks, ${stdout.length} bytes total`,
			)

			proc.terminal?.close()
			endTotal()

			callbacks.onComplete({
				stdout,
				stderr: "",
				exitCode,
				success: exitCode === 0,
			})
		})

		return {
			cancel: () => {
				cancelled = true
				proc.terminal?.close()
				proc.kill()
			},
		}
	} catch (error) {
		profileMsg(`  PTY error: ${error}, falling back to pipe streaming`)
		return executeStreaming(args, options, callbacks)
	}
}
