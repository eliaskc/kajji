import { profile } from "../utils/profiler"
import { execute, executeStreaming } from "./executor"

export interface FetchDiffOptions {
	cwd?: string
	columns?: number
	paths?: string[]
}

export async function fetchDiff(
	changeId: string,
	options: FetchDiffOptions = {},
): Promise<string> {
	const endTotal = profile(`fetchDiff(${changeId.slice(0, 8)})`)

	const env: Record<string, string> = {}

	if (options.columns) {
		env.COLUMNS = String(options.columns)
	}

	const args = [
		"diff",
		"-r",
		changeId,
		"--color",
		"always",
		"--ignore-working-copy",
	]

	if (options.paths && options.paths.length > 0) {
		args.push(...options.paths)
	}

	const result = await execute(args, { cwd: options.cwd, env })

	if (!result.success) {
		throw new Error(`jj diff failed: ${result.stderr}`)
	}

	endTotal()
	return result.stdout
}

export interface StreamDiffCallbacks {
	onUpdate: (content: string, lineCount: number, complete: boolean) => void
	onError: (error: Error) => void
}

export function streamDiff(
	changeId: string,
	options: FetchDiffOptions,
	callbacks: StreamDiffCallbacks,
): { cancel: () => void } {
	const endTotal = profile(`streamDiff(${changeId.slice(0, 8)})`)

	const env: Record<string, string> = {}

	if (options.columns) {
		env.COLUMNS = String(options.columns)
	}

	const args = [
		"diff",
		"-r",
		changeId,
		"--color",
		"always",
		"--ignore-working-copy",
	]

	if (options.paths && options.paths.length > 0) {
		args.push(...options.paths)
	}

	let firstUpdate = true
	const endFirstChunk = profile("  first chunk")

	return executeStreaming(
		args,
		{ cwd: options.cwd, env },
		{
			onChunk: (content, lineCount, _chunk) => {
				if (firstUpdate) {
					endFirstChunk(`${lineCount} lines`)
					firstUpdate = false
				}
				callbacks.onUpdate(content, lineCount, false)
			},
			onComplete: (result) => {
				endTotal()
				if (result.success) {
					callbacks.onUpdate(
						result.stdout,
						result.stdout.split("\n").length,
						true,
					)
				} else {
					callbacks.onError(new Error(`jj diff failed: ${result.stderr}`))
				}
			},
			onError: callbacks.onError,
		},
	)
}
