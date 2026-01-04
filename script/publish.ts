/**
 * Publish script for kajji
 * Usage: bun run script/publish.ts [--tag <tag>] [--dry-run]
 */

import { $ } from "bun"
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { join } from "node:path"

const pkg = JSON.parse(readFileSync("package.json", "utf-8"))
const version = pkg.version

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const tagArg = args.find((_, i) => args[i - 1] === "--tag")
const tag = tagArg || "latest"

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

for (const { os, arch } of platforms) {
	const name = `kajji-${os}-${arch}`
	const distDir = `dist/${name}`

	if (!existsSync(distDir)) {
		console.error(`Missing build: ${distDir}`)
		process.exit(1)
	}

	console.log(`Publishing ${name}...`)

	if (!dryRun) {
		await $`bun pm pack`.cwd(distDir).quiet()
		const tgz = (await $`ls *.tgz`.cwd(distDir).text()).trim()
		await $`npm publish ${tgz} --access public --tag ${tag}`.cwd(distDir)
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
	await $`npm publish ${tgz} --access public --tag ${tag}`.cwd(wrapperDir)
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
