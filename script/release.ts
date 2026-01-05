/**
 * Release script for kajji
 *
 * Usage: bun run script/release.ts [version]
 *
 * version: patch | minor | major | x.y.z (optional, auto-detects from commits)
 *
 * Prerequisites:
 * - No uncommitted changes
 * - HEAD matches origin/main
 * - CHANGELOG.md updated (use /changelog skill first)
 *
 * This script:
 * 1. Bumps version in package.json
 * 2. Commits package.json + CHANGELOG.md
 * 3. Creates git tag and pushes
 * 4. Builds binaries
 * 5. Publishes to npm
 * 6. Creates GitHub release
 */

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"

const pkg = JSON.parse(readFileSync("package.json", "utf-8"))
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
const nonChangelogChanges = changedFiles.filter(
	(line) => !line.endsWith("CHANGELOG.md"),
)
if (nonChangelogChanges.length > 0) {
	console.error(
		"Error: You have uncommitted changes (other than CHANGELOG.md).",
	)
	console.error("Commit or stash them before releasing.\n")
	console.error(nonChangelogChanges.join("\n"))
	process.exit(1)
}

const localHead = run("git rev-parse HEAD", { canFail: true })
const remoteMain = run("git rev-parse origin/main", { canFail: true })
if (localHead !== remoteMain) {
	console.error("Error: Local HEAD is not pushed to origin/main.")
	console.error(`  Local:  ${localHead}`)
	console.error(`  Remote: ${remoteMain}`)
	console.error("\nPush your changes first: git push origin main")
	process.exit(1)
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

const commitLog = run(`git log ${latestTag}..HEAD --format='%s%n%b---'`, {
	canFail: true,
})
if (!commitLog || commitLog === "---") {
	console.error("Error: No commits since last tag.")
	process.exit(1)
}

if (!existsSync("CHANGELOG.md")) {
	console.error("Error: CHANGELOG.md not found.")
	console.error("Generate it first with the /changelog skill.")
	process.exit(1)
}

function detectBumpType(log: string): "major" | "minor" | "patch" {
	const lines = log.toLowerCase()
	if (lines.includes("breaking change") || /^[a-z]+!:/m.test(log)) {
		return "major"
	}
	if (/^feat[:(]/m.test(log)) {
		return "minor"
	}
	return "patch"
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

let newVersion: string
let bumpType: "major" | "minor" | "patch"

if (versionArg) {
	if (["major", "minor", "patch"].includes(versionArg)) {
		bumpType = versionArg as "major" | "minor" | "patch"
		newVersion = bumpVersion(currentVersion, bumpType)
	} else if (/^\d+\.\d+\.\d+$/.test(versionArg)) {
		newVersion = versionArg
		bumpType = "patch"
	} else {
		console.error(`Invalid version argument: ${versionArg}`)
		console.error("Use: patch | minor | major | x.y.z")
		process.exit(1)
	}
} else {
	bumpType = detectBumpType(commitLog)
	newVersion = bumpVersion(currentVersion, bumpType)
	console.log(`Auto-detected bump type: ${bumpType}`)
}

console.log(`New version: ${newVersion}\n`)

console.log("Updating package.json...")
pkg.version = newVersion
writeFileSync("package.json", `${JSON.stringify(pkg, null, "\t")}\n`)

console.log("Committing release...")
run("git add package.json CHANGELOG.md")
run(`git commit -m "release: v${newVersion}"`)

console.log("Creating git tag...")
run(`git tag v${newVersion}`)

console.log("Pushing to origin...")
run("git push origin main")
run(`git push origin v${newVersion}`)

console.log("\nBuilding binaries...")
run("bun run script/build.ts", { inherit: true })

console.log("\nPublishing to npm...")
run("bun run script/publish.ts", { inherit: true })

console.log("\nCreating GitHub release...")
run(
	`gh release create v${newVersion} dist/*.tar.gz dist/*.zip --title "v${newVersion}" --notes-file CHANGELOG.md`,
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
