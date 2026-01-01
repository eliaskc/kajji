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
	const proc = Bun.spawn(["jj", ...args], {
		cwd: options.cwd,
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
	}
}

export async function executeWithColor(
	args: string[],
	options: ExecuteOptions = {},
): Promise<ExecuteResult> {
	return execute(["--color", "always", ...args], options)
}
