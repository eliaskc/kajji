import { findBinaryFiles } from "../utils/diff-binary"
import { execute } from "./executor"
import type { FileChange, FileStatus } from "./types"

const STATUS_MAP: Record<string, FileStatus> = {
	A: "added",
	M: "modified",
	D: "deleted",
	R: "renamed",
	C: "copied",
}

const BRACED_RENAME_REGEX = /^(.*)\{(.+) => (.+)\}(.*)$/

function parseRenamedPath(rawPath: string): {
	oldPath: string
	newPath: string
} {
	const match = rawPath.match(BRACED_RENAME_REGEX)
	if (match?.[2] && match[3]) {
		const prefix = match[1] ?? ""
		const oldPart = match[2]
		const newPart = match[3]
		const suffix = match[4] ?? ""
		return {
			oldPath: prefix + oldPart + suffix,
			newPath: prefix + newPart + suffix,
		}
	}

	const arrowIndex = rawPath.indexOf(" => ")
	if (arrowIndex !== -1) {
		return {
			oldPath: rawPath.slice(0, arrowIndex),
			newPath: rawPath.slice(arrowIndex + 4),
		}
	}

	return { oldPath: rawPath, newPath: rawPath }
}

export function parseFileSummary(output: string): FileChange[] {
	const files: FileChange[] = []

	for (const line of output.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed) continue

		const statusChar = trimmed[0]
		if (!statusChar) continue
		const status = STATUS_MAP[statusChar]
		if (!status) continue

		const rawPath = trimmed.slice(2)

		if (status === "renamed" || status === "copied") {
			const { oldPath, newPath } = parseRenamedPath(rawPath)
			files.push({ path: newPath, status, oldPath })
		} else {
			files.push({ path: rawPath, status })
		}
	}

	return files
}

export async function fetchFiles(revision: string): Promise<FileChange[]> {
	const summaryArgs = ["diff", "--summary", "-r", revision]
	const binaryArgs = ["diff", "--git", "-r", revision]

	const [summaryResult, binaryResult] = await Promise.all([
		execute(summaryArgs),
		execute(binaryArgs),
	])

	// Check for critical errors in both stdout and stderr (jj sometimes outputs errors to stdout)
	const combinedOutput =
		summaryResult.stdout +
		summaryResult.stderr +
		binaryResult.stdout +
		binaryResult.stderr
	if (/working copy is stale|stale working copy/i.test(combinedOutput)) {
		throw new Error(`The working copy is stale\n${combinedOutput}`)
	}

	if (!summaryResult.success) {
		throw new Error(`Failed to fetch files: ${summaryResult.stderr}`)
	}

	const binaryFiles = binaryResult.success
		? findBinaryFiles(binaryResult.stdout)
		: new Set<string>()

	return parseFileSummary(summaryResult.stdout).map((file) => ({
		...file,
		isBinary: binaryFiles.has(file.path),
	}))
}
