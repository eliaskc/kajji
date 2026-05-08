import { existsSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"
import type { ExecuteResult } from "../commander/executor"
import type { CommandObserver } from "../commander/observer"
import { readConfig } from "../config"
import { getRepoPath } from "../repo"

export interface HookRunOptions {
	verify?: boolean
	observer?: CommandObserver
}

export class HookError extends Error {
	constructor(
		message: string,
		readonly command: string,
		readonly result: ExecuteResult,
	) {
		super(message)
		this.name = "HookError"
	}
}

function expandHome(path: string): string {
	if (path === "~") return homedir()
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
	return path
}

function resolvePath(path: string, base = getRepoPath()): string {
	const expanded = expandHome(path)
	return isAbsolute(expanded) ? expanded : resolve(base, expanded)
}

function canonicalPath(path: string): string {
	const resolved = resolvePath(path)
	return existsSync(resolved) ? realpathSync(resolved) : resolved
}

function isPathWithin(path: string, parent: string): boolean {
	return path === parent || path.startsWith(`${parent}/`)
}

function commandText(command: string | { command: string }): string {
	return typeof command === "string" ? command : command.command
}

function isExecutable(path: string): boolean {
	try {
		return (statSync(path).mode & 0o111) !== 0
	} catch {
		return false
	}
}

async function readGitHooksPath(): Promise<string | undefined> {
	const proc = Bun.spawn(
		["git", "config", "--path", "--get", "core.hooksPath"],
		{
			cwd: getRepoPath(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	)
	const [stdout] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])
	const exitCode = await proc.exited
	if (exitCode !== 0) return undefined
	const path = stdout.trim()
	return path.length > 0 ? path : undefined
}

async function resolveGitHooksPath(): Promise<string | undefined> {
	const configuredPath = readConfig().gitHooksPath
	if (configuredPath === false) return undefined
	return configuredPath ?? (await readGitHooksPath())
}

async function runCommand(
	command: string,
	options: HookRunOptions,
	env?: Record<string, string>,
): Promise<ExecuteResult> {
	const logId = options.observer?.start(command, { kind: "hook" })

	const proc = Bun.spawn(["sh", "-lc", command], {
		cwd: getRepoPath(),
		env: {
			...process.env,
			...env,
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})

	return readHookProcess(proc, options, logId)
}

async function runExecutableHook(
	path: string,
	options: HookRunOptions,
): Promise<ExecuteResult> {
	const command = path
	const logId = options.observer?.start(command, { kind: "hook" })
	const proc = Bun.spawn([path], {
		cwd: getRepoPath(),
		env: process.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})

	return readHookProcess(proc, options, logId)
}

interface HookProcess {
	stdout: ReadableStream<Uint8Array>
	stderr: ReadableStream<Uint8Array>
	exited: Promise<number>
}

async function readHookProcess(
	proc: HookProcess,
	options: HookRunOptions,
	logId: string | undefined,
): Promise<ExecuteResult> {
	let stdout = ""
	let stderr = ""
	if (options.observer && logId) {
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
				options.observer?.append(logId, chunk)
			}
			const tail = decoder.decode()
			if (tail) {
				append(tail)
				options.observer?.append(logId, tail)
			}
		}
		await Promise.all([
			readStream(proc.stdout, (chunk) => {
				stdout += chunk
			}),
			readStream(proc.stderr, (chunk) => {
				stderr += chunk
			}),
		])
	} else {
		;[stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])
	}
	const exitCode = await proc.exited
	const result = {
		stdout,
		stderr,
		exitCode,
		success: exitCode === 0,
	}
	if (logId) options.observer?.finish(logId, result)
	return result
}

async function runGitPreCommitHook(
	options: HookRunOptions,
): Promise<ExecuteResult | undefined> {
	const hooksPath = await resolveGitHooksPath()
	if (!hooksPath) return undefined

	const hookPath = resolvePath(join(hooksPath, "pre-commit"))
	if (!existsSync(hookPath)) return undefined
	if (!isExecutable(hookPath)) {
		options.observer?.skip(`${hookPath} skipped because it is not executable`)
		return undefined
	}

	const result = await runExecutableHook(hookPath, options)
	if (!result.success) {
		throw new HookError(
			`Git hook ${basename(hookPath)} failed with exit code ${result.exitCode}: ${hookPath}`,
			hookPath,
			result,
		)
	}
	return result
}

export async function runPreHooks(
	operationId: string,
	options: HookRunOptions = {},
): Promise<ExecuteResult[]> {
	if (options.verify === false) {
		options.observer?.skip(`pre-hooks for ${operationId} skipped (--no-verify)`)
		return []
	}

	const hook = readConfig().hooks[operationId]
	const results: ExecuteResult[] = []

	let configuredHookCommands = hook?.pre ?? []
	if (hook?.onlyIn) {
		const repoPath = canonicalPath(getRepoPath())
		const onlyInPath = canonicalPath(hook.onlyIn)
		if (!isPathWithin(repoPath, onlyInPath)) configuredHookCommands = []
	}

	for (const hookCommand of configuredHookCommands) {
		const command = commandText(hookCommand)
		const env = typeof hookCommand === "string" ? undefined : hookCommand.env
		const result = await runCommand(command, options, env)
		results.push(result)

		if (!result.success) {
			throw new HookError(
				`Hook for ${operationId} failed with exit code ${result.exitCode}: ${command}`,
				command,
				result,
			)
		}
	}

	if (operationId === "jj.new") {
		const gitHookResult = await runGitPreCommitHook(options)
		if (gitHookResult) results.push(gitHookResult)
	}

	return results
}
