/**
 * Build script for kajji - compiles to native binaries for all platforms
 *
 * Usage: bun run script/build.ts [--target <platform>]
 * Platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64
 */

import { execSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"

const pkg = JSON.parse(readFileSync("package.json", "utf-8"))
const version = pkg.version

const allTargets = [
	{ os: "darwin", arch: "arm64" },
	{ os: "darwin", arch: "x64" },
	{ os: "linux", arch: "x64" },
	{ os: "linux", arch: "arm64" },
] as const

type Target = (typeof allTargets)[number]

const args = process.argv.slice(2)
const targetArg = args.find((_, i) => args[i - 1] === "--target")
const targets = targetArg
	? allTargets.filter((t) => `${t.os}-${t.arch}` === targetArg)
	: allTargets

if (targetArg && targets.length === 0) {
	console.error(`Unknown target: ${targetArg}`)
	console.error(
		`Available: ${allTargets.map((t) => `${t.os}-${t.arch}`).join(", ")}`,
	)
	process.exit(1)
}

// Ensure cross-platform OpenTUI packages are installed
// Bun respects os/cpu constraints so we need npm --force for cross-compilation
// Install ALL target platforms at once (npm --force can remove other cross-platform packages)
const coreVersion = pkg.dependencies["@opentui/core"]
const missingPlatforms = targets.filter(
	(t) => !existsSync(`node_modules/@opentui/core-${t.os}-${t.arch}`),
)
if (missingPlatforms.length > 0) {
	const packages = targets
		.map((t) => `@opentui/core-${t.os}-${t.arch}@${coreVersion}`)
		.join(" ")
	console.log("Installing cross-platform dependencies...")
	execSync(`npm install --no-save --force ${packages}`, {
		stdio: "inherit",
	})
	console.log()
}

rmSync("dist", { recursive: true, force: true })

console.log(`Building kajji v${version} for ${targets.length} platform(s)...\n`)

const results: { name: string; success: boolean; error?: string }[] = []

for (const target of targets) {
	const name = `kajji-${target.os}-${target.arch}`
	const outdir = `dist/${name}`
	const outfile = `${outdir}/bin/kajji`

	console.log(`Building ${name}...`)

	mkdirSync(dirname(outfile), { recursive: true })

	try {
		const bunTarget = `bun-${target.os}-${target.arch}`

		const result = await Bun.build({
			entrypoints: ["./src/index.tsx", "./src/diff/syntax-worker.ts"],
			minify: true,
			sourcemap: "none",
			plugins: [solidPlugin],
			conditions: ["browser"],
			define: {
				"process.env.KAJJI_VERSION": JSON.stringify(version),
			},
			compile: {
				target: bunTarget as "bun-darwin-arm64",
				outfile: outfile,
			},
		})

		if (!result.success) {
			for (const log of result.logs) {
				console.error(log.message || log)
			}
			throw new Error("Bundle failed")
		}

		const { chmod } = await import("node:fs/promises")
		await chmod(outfile, 0o755)

		const platformPkg = {
			name,
			version,
			description: `kajji binary for ${target.os} ${target.arch}`,
			os: [target.os],
			cpu: [target.arch],
			bin: {
				kajji: "./bin/kajji",
			},
			repository: pkg.repository,
			license: pkg.license,
			author: pkg.author,
		}
		writeFileSync(
			`${outdir}/package.json`,
			JSON.stringify(platformPkg, null, 2),
		)

		results.push({ name, success: true })
		console.log(`  -> ${outfile}`)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		results.push({ name, success: false, error: message })
		console.error(`  -> FAILED: ${message}`)
	}
}

console.log("\n--- Build Summary ---")
const successful = results.filter((r) => r.success)
const failed = results.filter((r) => !r.success)

console.log(`Success: ${successful.length}/${results.length}`)
if (failed.length > 0) {
	console.log(`Failed: ${failed.map((r) => r.name).join(", ")}`)
	process.exit(1)
}

export const binaries = successful.map((r) => r.name)
export { version }
