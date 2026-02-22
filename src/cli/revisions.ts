import { execute } from "../commander/executor"

export interface RevisionInfo {
	changeId: string
	commitId: string
	description: string
}

export async function fetchRevisions(revset: string): Promise<RevisionInfo[]> {
	const template =
		'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ description.first_line()'

	const result = await execute([
		"log",
		"-r",
		revset,
		"--no-graph",
		"-T",
		template,
	])
	if (!result.success) {
		throw new Error(result.stderr.trim() || "jj log failed")
	}

	const lines = result.stdout.split("\n").filter((line) => line.trim() !== "")
	return lines.map((line) => {
		const parts = line.split("\t")
		const changeId = parts[0] ?? ""
		const commitId = parts[1] ?? ""
		const description = parts.slice(2).join("\t") || "(no description set)"
		return { changeId, commitId, description }
	})
}
