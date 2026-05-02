#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const platformMap = { darwin: "darwin", linux: "linux" }
const archMap = { x64: "x64", arm64: "arm64" }

const platform = platformMap[os.platform()]
const arch = archMap[os.arch()]

if (!platform || !arch) {
	console.log(`Unsupported platform: ${os.platform()}-${os.arch()}`)
	process.exit(0)
}

const packageName = `kajji-${platform}-${arch}`

let packageDir
try {
	const packageJsonPath = require.resolve(`${packageName}/package.json`, {
		paths: [path.join(__dirname, "..")],
	})
	packageDir = path.dirname(packageJsonPath)
} catch {
	console.log(`Platform package ${packageName} not found, skipping symlink`)
	process.exit(0)
}

const binaryPath = path.join(packageDir, "bin", "kajji")
const targetPath = path.join(__dirname, "..", "bin", "kajji-binary")

if (!fs.existsSync(binaryPath)) {
	console.log(`Binary not found at ${binaryPath}`)
	process.exit(0)
}

try {
	if (fs.existsSync(targetPath)) {
		fs.unlinkSync(targetPath)
	}
	fs.symlinkSync(binaryPath, targetPath)
	console.log(`kajji binary linked: ${targetPath} -> ${binaryPath}`)
} catch (err) {
	console.log(`Could not create symlink: ${err.message}`)
}
