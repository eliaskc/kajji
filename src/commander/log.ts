import { execute } from "./executor"
import type { Commit } from "./types"

const MARKER = "__LJ__"

// Strip ANSI escape codes from a string (for extracting clean metadata)
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

function buildTemplate(): string {
	const styledDescription = `if(empty, label("empty", "(empty) "), "") ++ if(description.first_line(), description.first_line(), label("description placeholder", "(no description set)"))`

	const prefix = [
		`"${MARKER}"`,
		"change_id.short()",
		`"${MARKER}"`,
		"commit_id.short()",
		`"${MARKER}"`,
		"immutable",
		`"${MARKER}"`,
		"empty",
		`"${MARKER}"`,
		styledDescription,
		`"${MARKER}"`,
		"author.name()",
		`"${MARKER}"`,
		"author.email()",
		`"${MARKER}"`,
		'author.timestamp().local().format("%Y-%m-%d %H:%M:%S %:z")',
		`"${MARKER}"`,
	].join(" ++ ")

	return `${prefix} ++ builtin_log_compact`
}

export function parseLogOutput(output: string): Commit[] {
	const commits: Commit[] = []
	let current: Commit | null = null

	for (const line of output.split("\n")) {
		if (line.includes(MARKER)) {
			const parts = line.split(MARKER)
			if (parts.length >= 10) {
				if (current) {
					commits.push(current)
				}

				const gutter = parts[0] ?? ""
				current = {
					changeId: stripAnsi(parts[1] ?? ""),
					commitId: stripAnsi(parts[2] ?? ""),
					immutable: stripAnsi(parts[3] ?? "") === "true",
					empty: stripAnsi(parts[4] ?? "") === "true",
					description: stripAnsi(parts[5] ?? ""),
					author: stripAnsi(parts[6] ?? ""),
					authorEmail: stripAnsi(parts[7] ?? ""),
					timestamp: stripAnsi(parts[8] ?? ""),
					isWorkingCopy: gutter.includes("@"),
					lines: [gutter + (parts[9] ?? "")],
				}
				continue
			}
		}

		if (current && line.trim() !== "") {
			current.lines.push(line)
		}
	}

	if (current) {
		commits.push(current)
	}

	return commits
}

export interface FetchLogOptions {
	cwd?: string
	revset?: string
}

export async function fetchLog(options?: FetchLogOptions): Promise<Commit[]> {
	const template = buildTemplate()
	const args = ["log", "--color", "always", "--template", template]

	if (options?.revset) {
		args.push("-r", options.revset)
	}

	const result = await execute(args, {
		cwd: options?.cwd,
	})

	if (!result.success) {
		throw new Error(`jj log failed: ${result.stderr}`)
	}

	return parseLogOutput(result.stdout)
}
