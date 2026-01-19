/**
 * Release script for kajji
 *
 * Usage: bun run script/release.ts [version]
 *
 * version: patch | minor | major | x.y.z (optional, defaults to package.json)
 *
 * Prerequisites:
 * - CHANGELOG.md updated (use /changelog skill first)
 *
 * This script:
 * 1. Bumps version in package.json
 * 2. Builds binaries
 * 3. Publishes to npm
 * 4. Creates GitHub release
 */

import { execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const packageJson = readFileSync("package.json", "utf-8")
const pkg = JSON.parse(packageJson)
const currentVersion = pkg.version

function run(
	cmd: string,
	opts?: { inherit?: boolean; canFail?: boolean },
): string {
	try {
		if (opts?.inherit) {
			execSync(cmd, { encoding: "utf-8", stdio: "inherit" })
			return ""
		}
		return execSync(cmd, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()
	} catch (e: unknown) {
		if (opts?.canFail) {
			const error = e as { stdout?: Buffer; stderr?: Buffer }
			return error.stdout?.toString().trim() ?? ""
		}
		throw e
	}
}

const gitStatus = run("git status --porcelain", { canFail: true })
const changedFiles = gitStatus.split("\n").filter(Boolean)
if (changedFiles.length > 0) {
	console.warn("Warning: releasing with uncommitted changes:")
	console.warn(changedFiles.join("\n"))
	console.warn("Release will continue without committing or pushing.\n")
}

const latestTag = run("git tag --sort=-version:refname | head -1", {
	canFail: true,
})
if (!latestTag) {
	console.error("Error: No existing tags found. Create an initial tag first.")
	process.exit(1)
}

console.log(`Current version: ${currentVersion}`)
console.log(`Latest tag: ${latestTag}\n`)

if (!existsSync("CHANGELOG.md")) {
	console.error("Error: CHANGELOG.md not found.")
	console.error("Generate it first with the /changelog skill.")
	process.exit(1)
}

function bumpVersion(
	version: string,
	type: "major" | "minor" | "patch",
): string {
	const [major, minor, patch] = version.split(".").map(Number)
	switch (type) {
		case "major":
			return `${major + 1}.0.0`
		case "minor":
			return `${major}.${minor + 1}.0`
		case "patch":
			return `${major}.${minor}.${patch + 1}`
	}
}

const args = process.argv.slice(2)
const versionArg = args[0]

let newVersion = currentVersion

if (versionArg) {
	if (["major", "minor", "patch"].includes(versionArg)) {
		const bumpType = versionArg as "major" | "minor" | "patch"
		newVersion = bumpVersion(currentVersion, bumpType)
	} else if (/^\d+\.\d+\.\d+$/.test(versionArg)) {
		newVersion = versionArg
	} else {
		console.error(`Invalid version argument: ${versionArg}`)
		console.error("Use: patch | minor | major | x.y.z")
		process.exit(1)
	}
}

console.log(`New version: ${newVersion}\n`)

if (newVersion !== currentVersion) {
	console.log("Updating package.json...")
	pkg.version = newVersion
	const updatedPackageJson = packageJson.replace(
		/"version":\s*"[^"]+"/,
		`"version": "${newVersion}"`,
	)
	writeFileSync("package.json", updatedPackageJson)
}

console.log("Skipping commit, tag, and push (local release only)...")

console.log("\nBuilding binaries...")
run("bun run script/build.ts", { inherit: true })

console.log("\nPublishing to npm...")
run("bun run script/publish.ts", { inherit: true })

console.log("\nCreating GitHub release...")
const changelog = readFileSync("CHANGELOG.md", "utf-8")
const versionPattern = new RegExp(
	`## ${newVersion}\\n([\\s\\S]*?)(?=\\n## \\d|$)`,
)
const match = changelog.match(versionPattern)
const releaseNotes = match ? match[1].trim() : `Release v${newVersion}`
const notesFile = `/tmp/kajji-release-notes-${newVersion}.md`
writeFileSync(notesFile, releaseNotes)
run(
	`gh release create v${newVersion} dist/*.tar.gz dist/*.zip --title "v${newVersion}" --notes-file ${notesFile}`,
)
run(`gh release edit v${newVersion} --prerelease=false`)

console.log(`
${"=".repeat(60)}
RELEASE v${newVersion} COMPLETE
${"=".repeat(60)}

Published:
- npm: https://www.npmjs.com/package/kajji
- GitHub: https://github.com/eliaskc/kajji/releases/tag/v${newVersion}

Verify:
  npm install -g kajji@${newVersion} && kajji
  curl -fsSL https://raw.githubusercontent.com/eliaskc/kajji/main/install.sh | bash
`)
