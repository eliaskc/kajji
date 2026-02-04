/**
 * Publish script for kajji
 * Usage: bun run script/publish.ts [--tag <tag>] [--dry-run]
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const pkg = JSON.parse(readFileSync("package.json", "utf-8"))
const version = pkg.version

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const tagArg = args.find((_, i) => args[i - 1] === "--tag")
const tag = tagArg || "latest"

const maxPublishAttempts = 3
const baseRetryDelayMs = 1000

console.log(
	`Publishing kajji v${version} (tag: ${tag})${dryRun ? " [DRY RUN]" : ""}\n`,
)

const { binaries } = await import("./build.ts")

const platforms = [
	{ os: "darwin", arch: "arm64" },
	{ os: "darwin", arch: "x64" },
	{ os: "linux", arch: "x64" },
	{ os: "linux", arch: "arm64" },
]

const failures: string[] = []

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isPublished = async (name: string) => {
	try {
		const published = (
			await $`npm view ${name}@${version} version`.text()
		).trim()
		return published === version
	} catch {
		return false
	}
}

const isRetryable = (error: unknown) => {
	const message = String(error ?? "").toLowerCase()
	const retryable = [
		"ssl",
		"tls",
		"bad record mac",
		"econnreset",
		"etimedout",
		"eai_again",
		"socket hang up",
		"network",
		"timeout",
		"enotfound",
		"502",
		"503",
		"504",
	]
	return retryable.some((term) => message.includes(term))
}

const publishWithRetry = async (name: string, tgz: string, cwd: string) => {
	for (let attempt = 1; attempt <= maxPublishAttempts; attempt += 1) {
		try {
			await $`npm publish ${tgz} --access public --tag ${tag}`.cwd(cwd)
			return true
		} catch (error) {
			if (attempt === maxPublishAttempts || !isRetryable(error)) {
				console.error(`  -> failed ${name}@${version}`)
				console.error(String(error))
				return false
			}
			const delay = baseRetryDelayMs * 2 ** (attempt - 1)
			console.warn(
				`  -> retrying ${name}@${version} in ${delay}ms (attempt ${attempt + 1}/${maxPublishAttempts})`,
			)
			await sleep(delay)
		}
	}
	return false
}

for (const { os, arch } of platforms) {
	const name = `kajji-${os}-${arch}`
	const distDir = `dist/${name}`

	if (!existsSync(distDir)) {
		console.error(`Missing build: ${distDir}`)
		process.exit(1)
	}

	console.log(`Publishing ${name}...`)

	if (!dryRun) {
		if (await isPublished(name)) {
			console.log(`  -> already published ${name}@${version}`)
			continue
		}
		await $`bun pm pack`.cwd(distDir).quiet()
		const tgz = (await $`ls *.tgz`.cwd(distDir).text()).trim()
		const published = await publishWithRetry(name, tgz, distDir)
		if (!published) {
			failures.push(name)
			continue
		}
	}

	console.log(`  -> published ${name}@${version}`)
}

console.log("\nCreating wrapper package...")

const wrapperDir = "dist/kajji"
mkdirSync(wrapperDir, { recursive: true })
mkdirSync(`${wrapperDir}/bin`, { recursive: true })
mkdirSync(`${wrapperDir}/script`, { recursive: true })

cpSync("bin/kajji", `${wrapperDir}/bin/kajji`)
cpSync("script/postinstall.mjs", `${wrapperDir}/script/postinstall.mjs`)
cpSync("README.md", `${wrapperDir}/README.md`)
cpSync("LICENSE", `${wrapperDir}/LICENSE`)

const optionalDeps: Record<string, string> = {}
for (const { os, arch } of platforms) {
	optionalDeps[`kajji-${os}-${arch}`] = version
}

const wrapperPkg = {
	name: "kajji",
	version,
	description: pkg.description,
	bin: { kajji: "./bin/kajji" },
	scripts: { postinstall: "node ./script/postinstall.mjs" },
	optionalDependencies: optionalDeps,
	repository: pkg.repository,
	homepage: pkg.homepage,
	bugs: pkg.bugs,
	keywords: pkg.keywords,
	author: pkg.author,
	license: pkg.license,
}

writeFileSync(`${wrapperDir}/package.json`, JSON.stringify(wrapperPkg, null, 2))

console.log("Publishing kajji wrapper...")

if (!dryRun) {
	await $`bun pm pack`.cwd(wrapperDir).quiet()
	const tgz = (await $`ls *.tgz`.cwd(wrapperDir).text()).trim()
	if (await isPublished("kajji")) {
		console.log(`  -> already published kajji@${version}`)
	} else if (failures.length > 0) {
		console.error(
			`Skipping wrapper publish due to failed platform publishes: ${failures.join(", ")}`,
		)
	} else {
		const published = await publishWithRetry("kajji", tgz, wrapperDir)
		if (!published) {
			failures.push("kajji")
		}
	}
}

console.log(`  -> published kajji@${version}`)

console.log("\nCreating GitHub release archives...")

for (const { os, arch } of platforms) {
	const name = `kajji-${os}-${arch}`
	const distDir = `dist/${name}/bin`
	const archiveName = `kajji-${os}-${arch}`

	if (os === "linux") {
		await $`tar -czf ../../${archiveName}.tar.gz kajji`.cwd(distDir)
		console.log(`  -> dist/${archiveName}.tar.gz`)
	} else {
		await $`zip -q ../../${archiveName}.zip kajji`.cwd(distDir)
		console.log(`  -> dist/${archiveName}.zip`)
	}
}

console.log("\nDone! Release artifacts in dist/")
console.log("\nNext steps:")
console.log(`  1. git tag v${version}`)
console.log(`  2. git push origin v${version}`)
console.log(
	`  3. gh release create v${version} dist/*.tar.gz dist/*.zip --title "v${version}"`,
)

if (failures.length > 0) {
	throw new Error(`Publish failed for: ${failures.join(", ")}`)
}
