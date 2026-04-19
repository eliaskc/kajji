import { defineCommand } from "citty"
import type { DiffFile } from "../diff/parser"
import { fetchParsedDiff } from "../diff/parser"
import { formatLineRange } from "./format"
import { fetchRevisions } from "./revisions"

type FileStatus = "modified" | "added" | "deleted" | "renamed"

interface HunkOutput {
	id: string
	oldStart: number
	oldCount: number
	newStart: number
	newCount: number
	added: number
	removed: number
	diff?: string
}

interface FileOutput {
	path: string
	status: FileStatus
	isBinary?: boolean
	hunks: HunkOutput[]
}

interface RevisionOutput {
	changeId: string
	commitId: string
	description: string
	files: FileOutput[]
}

interface ChangesJsonOutput {
	revisions: RevisionOutput[]
}

function mapStatus(type: DiffFile["type"]): FileStatus {
	switch (type) {
		case "new":
			return "added"
		case "deleted":
			return "deleted"
		case "rename-pure":
		case "rename-changed":
			return "renamed"
		default:
			return "modified"
	}
}

function buildHunkDiff(
	file: DiffFile,
	hunk: DiffFile["hunks"][number],
): string {
	const header = `@@ -${hunk.deletionStart},${hunk.deletionLines} +${hunk.additionStart},${hunk.additionLines} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ""}`
	const lines: string[] = [header]
	const normalizeLine = (line: string) => line.replace(/[\r\n]+$/g, "")

	for (const content of hunk.hunkContent) {
		if (content.type === "context") {
			for (let i = 0; i < content.lines; i++) {
				const line = file.additionLines[content.additionLineIndex + i] ?? ""
				lines.push(` ${normalizeLine(line)}`)
			}
			continue
		}

		for (let i = 0; i < content.deletions; i++) {
			const line = file.deletionLines[content.deletionLineIndex + i] ?? ""
			lines.push(`-${normalizeLine(line)}`)
		}
		for (let i = 0; i < content.additions; i++) {
			const line = file.additionLines[content.additionLineIndex + i] ?? ""
			lines.push(`+${normalizeLine(line)}`)
		}
	}

	return lines.join("\n")
}

export const changesCommand = defineCommand({
	meta: {
		name: "changes",
		description: "List changes with addressable hunk IDs",
	},
	args: {
		revisions: {
			alias: "r",
			type: "string",
			default: "@",
			description: "Target revisions to show",
		},
		json: {
			type: "boolean",
			description: "Output JSON",
		},
		diff: {
			type: "boolean",
			description: "Include unified diff per hunk",
		},
	},
	async run({ args }) {
		const input = args as {
			revisions?: string
			json?: boolean
			diff?: boolean
		}
		const revset = input.revisions || "@"
		const revisions = await fetchRevisions(revset)

		const output: RevisionOutput[] = []

		for (const revision of revisions) {
			const files = await fetchParsedDiff(revision.commitId)
			let hunkCounter = 0
			const fileOutputs = files.map((file) => {
				const hunks = file.hunks.map((hunk) => {
					hunkCounter += 1
					return {
						id: `h${hunkCounter}`,
						oldStart: hunk.deletionStart,
						oldCount: hunk.deletionLines,
						newStart: hunk.additionStart,
						newCount: hunk.additionLines,
						added: hunk.additionCount,
						removed: hunk.deletionCount,
						diff: input.diff ? buildHunkDiff(file, hunk) : undefined,
					}
				})

				return {
					path: file.name,
					status: mapStatus(file.type),
					isBinary: file.isBinary,
					hunks,
				}
			})

			output.push({
				changeId: revision.changeId,
				commitId: revision.commitId,
				description: revision.description,
				files: fileOutputs,
			})
		}

		if (input.json) {
			const jsonOutput: ChangesJsonOutput = { revisions: output }
			console.log(JSON.stringify(jsonOutput, null, 2))
			return
		}

		if (output.length === 0) {
			console.log("No changes found")
			return
		}

		for (const revision of output) {
			console.log(`${revision.changeId} - "${revision.description}"`)
			for (const file of revision.files) {
				const indicator =
					file.status === "added"
						? "A"
						: file.status === "deleted"
							? "D"
							: file.status === "renamed"
								? "R"
								: "M"
				console.log(`  ${file.path} (${indicator})`)
				for (const hunk of file.hunks) {
					const range = formatLineRange(
						hunk.oldStart,
						hunk.oldCount,
						hunk.newStart,
						hunk.newCount,
					)
					console.log(
						`    ${hunk.id}  lines ${range}   +${hunk.added} -${hunk.removed}`,
					)
					if (input.diff && hunk.diff) {
						for (const line of hunk.diff.split("\n")) {
							console.log(`      ${line}`)
						}
					}
				}
			}
			if (output.length > 1) {
				console.log("")
			}
		}
	},
})
