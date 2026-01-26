import { stdin as input, stdout as output } from "node:process"
import { defineCommand } from "citty"
import { nanoid } from "nanoid"
import { execute } from "../commander/executor"
import {
	buildHunkAnchor,
	buildHunkIndex,
	relocateRevision,
} from "../comments/relocate"
import {
	readComments,
	resolveRepoRoot,
	writeComments,
} from "../comments/storage"
import type {
	CommentAnchor,
	CommentAnchorLine,
	CommentEntry,
} from "../comments/types"
import { fetchParsedDiff } from "../diff/parser"
import { formatLineRange } from "./format"
import { type RevisionInfo, fetchRevisions } from "./revisions"

async function resolveSingleRevision(revset: string): Promise<RevisionInfo> {
	const revisions = await fetchRevisions(revset)
	if (revisions.length === 0) {
		throw new Error(`No revisions found for revset: ${revset}`)
	}
	if (revisions.length > 1) {
		throw new Error(`Revset '${revset}' resolves to multiple revisions`)
	}
	const revision = revisions[0]
	if (!revision) {
		throw new Error(`No revisions found for revset: ${revset}`)
	}
	return revision
}

function parseLineNumber(input: string | number | undefined): number {
	if (input === undefined || input === null) {
		throw new Error("Missing required option: --line")
	}
	const value = Number(input)
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`Invalid line number: ${input}`)
	}
	return value
}

function createCommentEntry(args: {
	message: string
	author: string
	explanation: boolean
	type: string
}): CommentEntry {
	const commentType = args.explanation ? "explanation" : args.type
	return {
		id: `cmt_${nanoid(8)}`,
		text: args.message,
		author: args.author,
		type: commentType,
		createdAt: new Date().toISOString(),
		replyTo: null,
	}
}

function formatCount(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`
}

function colorSymbol(symbol: string, colorCode: string): string {
	if (!output.isTTY) return symbol
	return `\x1b[${colorCode}m${symbol}\x1b[0m`
}

async function confirmAction(
	message: string,
	force?: boolean,
): Promise<boolean> {
	if (force) return true
	if (!input.isTTY) {
		throw new Error("Confirmation required (use --yes to skip)")
	}

	return await new Promise((resolve) => {
		const prompt = `${message} [y]/n `
		const onData = (data: Buffer) => {
			const key = data.toString("utf8")
			let decision: boolean | null = null

			if (key === "\r" || key === "\n") {
				decision = true
			} else if (key.toLowerCase() === "y") {
				decision = true
			} else if (key.toLowerCase() === "n") {
				decision = false
			} else {
				return
			}

			input.setRawMode(false)
			input.pause()
			input.off("data", onData)
			if (decision) {
				const symbol = colorSymbol("✓", "32")
				output.write(`: ${symbol} Deleted\n`)
			} else {
				const symbol = colorSymbol("✗", "31")
				output.write(`: ${symbol} Cancelled\n`)
			}
			resolve(decision)
		}

		input.setRawMode(true)
		input.resume()
		output.write(prompt)
		input.on("data", onData)
	})
}

async function readFileLinesAtRevision(
	revision: string,
	filePath: string,
): Promise<string[]> {
	const result = await execute(["file", "show", "-r", revision, filePath])
	if (!result.success) {
		throw new Error(result.stderr.trim() || `Unable to read ${filePath}`)
	}
	const normalized = result.stdout.replace(/\r\n/g, "\n")
	const lines = normalized.split("\n")
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop()
	}
	return lines
}

function getLineContextLines(
	lines: string[],
	lineNumber: number,
	maxLines = 5,
): string[] {
	const index = lineNumber - 1
	if (index < 0 || index >= lines.length) {
		throw new Error(`Line ${lineNumber} is out of range`)
	}
	const start = Math.max(0, index - 2)
	const end = Math.min(lines.length, index + 3)
	const result: string[] = []
	for (let i = start; i < end; i += 1) {
		const line = lines[i]?.trim()
		if (line) {
			result.push(line)
		}
		if (result.length >= maxLines) break
	}
	return result
}

export const commentCommand = defineCommand({
	meta: {
		name: "comment",
		description: "Manage comments",
	},
	subCommands: {
		list: defineCommand({
			meta: {
				name: "list",
				description: "List comments",
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
			},
			async run({ args }) {
				const input = args as { revisions?: string; json?: boolean }
				await listComments({ revisions: input.revisions, json: input.json })
			},
		}),
		set: defineCommand({
			meta: {
				name: "set",
				description: "Add a comment to a hunk or line",
			},
			args: {
				revisions: {
					alias: "r",
					type: "string",
					default: "@",
					description: "Target revisions",
				},
				hunk: {
					type: "string",
					description: "Hunk ID (h1, h2, ...)",
				},
				file: {
					type: "string",
					description: "Target file path",
				},
				line: {
					type: "string",
					description: "Target line number",
				},
				side: {
					type: "string",
					description: "Line side (new or old)",
				},
				message: {
					alias: "m",
					type: "string",
					required: true,
					description: "Comment text",
				},
				author: {
					type: "string",
					default: "human",
					description: "Comment author label",
				},
				explanation: {
					type: "boolean",
					description: "Mark as explanation",
				},
				type: {
					type: "string",
					default: "feedback",
					description: "Comment type",
				},
			},
			async run({ args }) {
				const rev = (args as { revisions?: string }).revisions ?? "@"
				const hunk = (args as { hunk?: string }).hunk
				const file = (args as { file?: string }).file
				const lineInput = (args as { line?: string | number }).line
				const sideInput = (args as { side?: string }).side
				const message = (args as { message?: string }).message
				const author = (args as { author?: string }).author ?? "human"
				const explanation = Boolean(
					(args as { explanation?: boolean }).explanation,
				)
				const type = (args as { type?: string }).type ?? "feedback"
				if (!message) {
					throw new Error("Missing required option: --message")
				}
				if (hunk && (file || lineInput)) {
					throw new Error("Use either --hunk or --file/--line")
				}
				if (!hunk && (!file || lineInput === undefined)) {
					throw new Error("Provide --hunk or --file/--line")
				}
				if (sideInput && sideInput !== "new" && sideInput !== "old") {
					throw new Error("--side must be 'new' or 'old'")
				}
				const revision = await resolveSingleRevision(rev)
				const repoRoot = await resolveRepoRoot()
				const state = readComments(repoRoot)
				const revisionEntry = state.revisions[revision.changeId] ?? {
					commitHash: revision.commitId,
					anchors: [],
				}
				revisionEntry.commitHash = revision.commitId

				if (hunk) {
					const files = await fetchParsedDiff(revision.changeId)
					const hunks = buildHunkIndex(files)
					const target = hunks.find((entry) => entry.id === hunk)
					if (!target) {
						throw new Error(`Hunk not found: ${hunk}`)
					}
					const anchor = buildHunkAnchor(hunk, target.filePath, target.hunk)
					const comment = createCommentEntry({
						message,
						author,
						explanation,
						type,
					})
					const existingIndex = revisionEntry.anchors.findIndex(
						(entry) => entry.type === "hunk" && entry.id === hunk,
					)
					if (existingIndex >= 0) {
						const existing = revisionEntry.anchors[
							existingIndex
						] as CommentAnchor
						if (existing.type === "hunk") {
							revisionEntry.anchors[existingIndex] = {
								...existing,
								filePath: anchor.filePath,
								lineRange: anchor.lineRange,
								contextLines: anchor.contextLines,
								stale: false,
								comments: [...existing.comments, comment],
							}
						}
					} else {
						revisionEntry.anchors.push({
							...anchor,
							comments: [comment],
							stale: false,
						})
					}
					state.revisions[revision.changeId] = revisionEntry
					writeComments(repoRoot, state)
					console.log(`Added comment ${comment.id} on ${hunk}`)
					return
				}

				const lineNumber = parseLineNumber(lineInput)
				const filePath = file ?? ""
				const fileLines = await readFileLinesAtRevision(
					revision.changeId,
					filePath,
				)
				const contextLines = getLineContextLines(fileLines, lineNumber)
				const comment = createCommentEntry({
					message,
					author,
					explanation,
					type,
				})
				const side = sideInput as "new" | "old" | undefined
				const existingIndex = revisionEntry.anchors.findIndex((entry) => {
					if (entry.type !== "line") return false
					if (entry.filePath !== filePath) return false
					if (entry.lineNumber !== lineNumber) return false
					if (side) return entry.side === side
					return entry.side === undefined
				})
				if (existingIndex >= 0) {
					const existing = revisionEntry.anchors[
						existingIndex
					] as CommentAnchorLine
					revisionEntry.anchors[existingIndex] = {
						...existing,
						contextLines,
						stale: false,
						comments: [...existing.comments, comment],
					}
				} else {
					revisionEntry.anchors.push({
						id: `l_${nanoid(8)}`,
						type: "line",
						filePath,
						lineNumber,
						side,
						contextLines,
						comments: [comment],
						stale: false,
					})
				}
				state.revisions[revision.changeId] = revisionEntry
				writeComments(repoRoot, state)
				const sideLabel = side ? ` (${side})` : ""
				console.log(
					`Added comment ${comment.id} on ${filePath}:${lineNumber}${sideLabel}`,
				)
			},
		}),
		delete: defineCommand({
			meta: {
				name: "delete",
				description: "Delete comment(s)",
			},
			args: {
				id: {
					type: "positional",
					description: "Comment ID",
					required: false,
				},
				revisions: {
					alias: "r",
					type: "string",
					default: "@",
					description: "Target revisions",
				},
				hunk: {
					type: "string",
					description: "Hunk ID",
				},
				file: {
					type: "string",
					description: "Target file path",
				},
				line: {
					type: "string",
					description: "Target line number",
				},
				side: {
					type: "string",
					description: "Line side (new or old)",
				},
				all: {
					type: "boolean",
					description: "Delete all comments in revision",
				},
				yes: {
					alias: "y",
					type: "boolean",
					description: "Skip confirmation",
				},
			},
			async run({ args }) {
				const repoRoot = await resolveRepoRoot()
				const state = readComments(repoRoot)
				let updated = false

				if (args.id) {
					const id = args.id
					for (const [changeId, revision] of Object.entries(state.revisions)) {
						const nextAnchors: CommentAnchor[] = []
						for (const anchor of revision.anchors) {
							const nextComments = anchor.comments.filter(
								(comment) => comment.id !== id,
							)
							if (nextComments.length !== anchor.comments.length) {
								updated = true
							}
							if (nextComments.length > 0) {
								nextAnchors.push({
									...anchor,
									comments: nextComments,
								})
							}
						}
						if (nextAnchors.length > 0) {
							revision.anchors = nextAnchors
						} else {
							delete state.revisions[changeId]
						}
					}

					if (!updated) {
						throw new Error(`Comment not found: ${id}`)
					}
					writeComments(repoRoot, state)
					console.log(`Deleted comment ${id}`)
					return
				}

				const rev = (args as { revisions?: string }).revisions ?? "@"
				const hunk = (args as { hunk?: string }).hunk
				const file = (args as { file?: string }).file
				const lineInput = (args as { line?: string | number }).line
				const sideInput = (args as { side?: string }).side
				const all = Boolean((args as { all?: boolean }).all)
				const yes = Boolean((args as { yes?: boolean }).yes)
				if (sideInput && sideInput !== "new" && sideInput !== "old") {
					throw new Error("--side must be 'new' or 'old'")
				}
				if (all && (hunk || file || lineInput)) {
					throw new Error("Use either --all or specific filters")
				}
				if (hunk && (file || lineInput)) {
					throw new Error("Use either --hunk or --file/--line")
				}
				if (!all && !hunk && !file && lineInput !== undefined) {
					throw new Error("Provide --file with --line")
				}
				if (!all && !hunk && !file && lineInput === undefined) {
					throw new Error(
						"Provide a comment ID, --hunk, --file/--line, --file, or --all",
					)
				}
				const revision = await resolveSingleRevision(rev)
				const entry = state.revisions[revision.changeId]
				if (!entry) {
					throw new Error("No comments for that revision")
				}

				const side = sideInput as "new" | "old" | undefined
				let removedCount = 0
				let removedLabel = ""
				if (all) {
					const total = entry.anchors.reduce(
						(sum, anchor) => sum + anchor.comments.length,
						0,
					)
					const confirmed = await confirmAction(
						`Delete ${formatCount(total, "comment")} from revision ${revision.changeId}?`,
						yes,
					)
					if (!confirmed) {
						return
					}
					delete state.revisions[revision.changeId]
					updated = true
					writeComments(repoRoot, state)
					return
				}
				if (hunk) {
					const nextAnchors = entry.anchors.filter((anchor) => {
						if (anchor.type !== "hunk") return true
						if (anchor.id !== hunk) return true
						removedCount += anchor.comments.length
						removedLabel = hunk
						return false
					})
					if (removedCount === 0) {
						throw new Error("No comments for that hunk")
					}
					entry.anchors = nextAnchors
				} else if (lineInput !== undefined) {
					const lineNumber = parseLineNumber(lineInput)
					const filePath = file ?? ""
					const nextAnchors = entry.anchors.filter((anchor) => {
						if (anchor.type !== "line") return true
						if (anchor.filePath !== filePath) return true
						if (anchor.lineNumber !== lineNumber) return true
						if (side && anchor.side !== side) return true
						removedCount += anchor.comments.length
						removedLabel = `${filePath}:${lineNumber}${side ? ` (${side})` : ""}`
						return false
					})
					if (removedCount === 0) {
						throw new Error("No comments for that line")
					}
					entry.anchors = nextAnchors
				} else if (file) {
					const filePath = file
					const nextAnchors = entry.anchors.filter((anchor) => {
						if (anchor.filePath !== filePath) return true
						removedCount += anchor.comments.length
						return false
					})
					if (removedCount === 0) {
						throw new Error("No comments for that file")
					}
					const confirmed = await confirmAction(
						`Delete ${formatCount(removedCount, "comment")} from ${filePath}?`,
						yes,
					)
					if (!confirmed) {
						return
					}
					entry.anchors = nextAnchors
					removedLabel = filePath
				}

				updated = true
				if (entry.anchors.length === 0) {
					delete state.revisions[revision.changeId]
				}
				if (updated) {
					writeComments(repoRoot, state)
					console.log(
						`Deleted ${formatCount(removedCount, "comment")} from ${removedLabel}`,
					)
				}
			},
		}),
	},
})

async function listComments(args: {
	revisions?: string
	json?: boolean
}): Promise<void> {
	const repoRoot = await resolveRepoRoot()
	const state = readComments(repoRoot)
	const revisions = await fetchRevisions(args.revisions ?? "@")
	const output: Array<{
		changeId: string
		commitId: string
		description: string
		anchors: CommentAnchor[]
	}> = []

	let mutated = false

	for (const revision of revisions) {
		const stored = state.revisions[revision.changeId]
		if (!stored) continue

		if (stored.commitHash !== revision.commitId) {
			const files = await fetchParsedDiff(revision.changeId)
			const relocation = relocateRevision(stored, files)
			state.revisions[revision.changeId] = {
				...relocation.updated,
				commitHash: revision.commitId,
			}
			mutated = true
		}

		const updated = state.revisions[revision.changeId]
		if (!updated) continue
		if (updated.anchors.length === 0) continue
		output.push({
			changeId: revision.changeId,
			commitId: revision.commitId,
			description: revision.description,
			anchors: updated.anchors,
		})
	}

	if (mutated) {
		writeComments(repoRoot, state)
	}

	if (args.json) {
		const json = {
			revisions: output.map((revision) => ({
				changeId: revision.changeId,
				commitId: revision.commitId,
				description: revision.description,
				anchors: revision.anchors.map((anchor) => ({
					...anchor,
					stale: anchor.stale ?? false,
				})),
			})),
		}
		console.log(JSON.stringify(json, null, 2))
		return
	}

	if (output.length === 0) {
		console.log("No comments found")
		return
	}

	for (const revision of output) {
		console.log(`${revision.changeId} - "${revision.description}"`)
		for (const anchor of revision.anchors) {
			if (anchor.type === "hunk") {
				const range = formatLineRange(
					anchor.lineRange.oldStart,
					anchor.lineRange.oldCount,
					anchor.lineRange.newStart,
					anchor.lineRange.newCount,
				)
				const staleLabel = anchor.stale ? " (stale)" : ""
				console.log(
					`  ${anchor.id}${staleLabel} ${anchor.filePath} lines ${range}`,
				)
				for (const comment of anchor.comments) {
					console.log(
						`    ${comment.id} (${comment.author}/${comment.type}) ${comment.text}`,
					)
				}
				continue
			}
			const sideLabel = anchor.side ? ` (${anchor.side})` : ""
			const staleLabel = anchor.stale ? " (stale)" : ""
			console.log(
				`  ${anchor.filePath}:${anchor.lineNumber}${sideLabel}${staleLabel}`,
			)
			for (const comment of anchor.comments) {
				console.log(
					`    ${comment.id} (${comment.author}/${comment.type}) ${comment.text}`,
				)
			}
		}
		if (output.length > 1) {
			console.log("")
		}
	}
}
