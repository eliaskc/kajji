/**
 * Extract release notes for a specific version from CHANGELOG.md.
 *
 * Usage: bun run script/extract-release-notes.ts <version>
 *
 * Prints the body of the `## <version>` section to stdout (without the heading).
 * Exits non-zero if the section is missing.
 */

import { readFileSync } from "node:fs"

const version = process.argv[2]
if (!version) {
	console.error("Usage: bun run script/extract-release-notes.ts <version>")
	process.exit(1)
}

const changelog = readFileSync("CHANGELOG.md", "utf-8")
// Match `## <version>` up to the next `## <digit>` heading or end of file.
const escaped = version.replace(/\./g, "\\.")
const pattern = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## \\d|$)`)
const match = changelog.match(pattern)
if (!match) {
	console.error(`No section for v${version} found in CHANGELOG.md`)
	process.exit(2)
}

process.stdout.write(`${match[1].trim()}\n`)
