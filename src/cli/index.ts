import { defineCommand, runMain } from "citty"
import { getCurrentVersion } from "../utils/update"
import { changesCommand } from "./changes"
import { commentCommand } from "./comment"
import { uninstallCommand } from "./uninstall"

const main = defineCommand({
	meta: {
		name: "kajji",
		version: getCurrentVersion(),
		description: "Kajji CLI",
	},
	subCommands: {
		changes: changesCommand,
		comment: commentCommand,
		uninstall: uninstallCommand,
	},
})

export async function runCli(args: string[]): Promise<void> {
	let normalizedArgs = args
	if (normalizedArgs[0] === "help") {
		const target = normalizedArgs[1]
		const sub = normalizedArgs[2]
		if (target && sub) {
			normalizedArgs = [target, sub, "--help"]
		} else {
			normalizedArgs = target ? [target, "--help"] : ["--help"]
		}
	}
	if (normalizedArgs[0] === "-V") {
		normalizedArgs = ["--version"]
	}
	if (normalizedArgs[0] === "changes") {
		const firstArg = normalizedArgs[1]
		if (firstArg && !firstArg.startsWith("-")) {
			console.error(
				"Use -r/--revisions for revsets. Example: kajji changes -r @",
			)
			process.exit(1)
		}
	}
	await runMain(main, { rawArgs: normalizedArgs })
}
