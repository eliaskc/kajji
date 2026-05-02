#!/usr/bin/env bun
/**
 * Profile script for kajji
 * Usage: bun profile -m "description of what you're testing"
 */

import { parseArgs } from "node:util"

// Check for help flag manually
if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
	console.log("Usage: bun profile [-m <message>]")
	console.log("")
	console.log("Options:")
	console.log("  -m, --message  Description for this profile session")
	console.log("")
	console.log("Example:")
	console.log('  bun profile -m "testing lock contention fix"')
	process.exit(0)
}

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		message: {
			type: "string",
			short: "m",
			default: "profile",
		},
	},
	strict: true,
	allowPositionals: false,
})

// Sanitize message for use as filename
const sanitizedName = (values.message ?? "profile")
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, "-")
	.replace(/^-|-$/g, "")
	.slice(0, 50)

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const profileName = `${timestamp}_${sanitizedName}`

console.log(`Starting profile: ${values.message}`)
console.log(`Log file: .kajji-profiles/${profileName}.log`)
console.log()

// Run the app with profiling enabled
const proc = Bun.spawn(["bun", "run", "src/index.tsx"], {
	env: {
		...process.env,
		KAJJI_PROFILE: "1",
		KAJJI_PROFILE_NAME: profileName,
		KAJJI_PROFILE_MESSAGE: values.message,
		NODE_ENV: "development",
	},
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
})

await proc.exited
