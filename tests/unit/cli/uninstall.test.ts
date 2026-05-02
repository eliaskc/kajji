import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	cleanShellConfigContent,
	findShellConfig,
	getUninstallCommand,
} from "../../../src/cli/uninstall"

describe("getUninstallCommand", () => {
	test("returns the right command per package manager", () => {
		expect(getUninstallCommand("brew")).toEqual(["brew", "uninstall", "kajji"])
		expect(getUninstallCommand("npm")).toEqual([
			"npm",
			"uninstall",
			"-g",
			"kajji",
		])
		expect(getUninstallCommand("bun")).toEqual(["bun", "remove", "-g", "kajji"])
		expect(getUninstallCommand("pnpm")).toEqual([
			"pnpm",
			"uninstall",
			"-g",
			"kajji",
		])
		expect(getUninstallCommand("yarn")).toEqual([
			"yarn",
			"global",
			"remove",
			"kajji",
		])
	})

	test("returns null for curl/unknown", () => {
		expect(getUninstallCommand("curl")).toBeNull()
		expect(getUninstallCommand("unknown")).toBeNull()
	})
})

describe("cleanShellConfigContent", () => {
	const binDir = "/Users/test/.kajji/bin"

	test("removes the # kajji marker and the following PATH line", () => {
		const input = [
			"# my zshrc",
			"export FOO=bar",
			"",
			"# kajji",
			`export PATH=${binDir}:$PATH`,
			"",
		].join("\n")
		const expected = ["# my zshrc", "export FOO=bar", ""].join("\n")
		expect(cleanShellConfigContent(input, binDir)).toBe(expected)
	})

	test("removes a fish_add_path line after the marker", () => {
		const input = [
			"set -x EDITOR vim",
			"",
			"# kajji",
			`fish_add_path ${binDir}`,
		].join("\n")
		const expected = ["set -x EDITOR vim"].join("\n")
		expect(cleanShellConfigContent(input, binDir)).toBe(expected)
	})

	test("preserves trailing newline state", () => {
		const withNewline = `export FOO=1\n# kajji\nexport PATH=${binDir}:$PATH\n`
		const withoutNewline = `export FOO=1\n# kajji\nexport PATH=${binDir}:$PATH`
		expect(cleanShellConfigContent(withNewline, binDir).endsWith("\n")).toBe(
			true,
		)
		expect(cleanShellConfigContent(withoutNewline, binDir).endsWith("\n")).toBe(
			false,
		)
	})

	test("does not touch unrelated lines that mention the bin dir", () => {
		// A user could legitimately reference the path elsewhere; we should only
		// strip lines directly adjacent to our marker.
		const input = [
			"# my custom setup",
			`alias kajji-bin='ls ${binDir}'`,
			"",
			"# kajji",
			`export PATH=${binDir}:$PATH`,
		].join("\n")
		const expected = [
			"# my custom setup",
			`alias kajji-bin='ls ${binDir}'`,
		].join("\n")
		expect(cleanShellConfigContent(input, binDir)).toBe(expected)
	})

	test("leaves a stray '# kajji' marker alone if no PATH line follows", () => {
		// Be conservative: if the next line isn't ours, don't drop the marker —
		// it might be a user comment.
		const input = ["# kajji", "echo hello"].join("\n")
		expect(cleanShellConfigContent(input, binDir)).toBe(input)
	})
})

describe("findShellConfig", () => {
	let tmpHome: string

	beforeEach(() => {
		tmpHome = mkdtempSync(join(tmpdir(), "kajji-uninstall-test-"))
	})

	afterEach(() => {
		rmSync(tmpHome, { recursive: true, force: true })
	})

	test("finds the first zsh file containing the marker", () => {
		const zshenv = join(tmpHome, ".zshenv")
		const zshrc = join(tmpHome, ".zshrc")
		writeFileSync(zshenv, "export FOO=1\n")
		writeFileSync(
			zshrc,
			`export FOO=2\n\n# kajji\nexport PATH=${tmpHome}/.kajji/bin:$PATH\n`,
		)

		const found = findShellConfig({ SHELL: "/bin/zsh" }, tmpHome)
		expect(found).toBe(zshrc)
	})

	test("finds .zprofile when zshrc/zshenv aren't touched", () => {
		const zprofile = join(tmpHome, ".zprofile")
		writeFileSync(
			zprofile,
			`# kajji\nexport PATH=${tmpHome}/.kajji/bin:$PATH\n`,
		)

		const found = findShellConfig({ SHELL: "/bin/zsh" }, tmpHome)
		expect(found).toBe(zprofile)
	})

	test("finds fish config under XDG_CONFIG_HOME", () => {
		const xdg = join(tmpHome, "xdg")
		const fishConfig = join(xdg, "fish", "config.fish")
		mkdirSync(dirname(fishConfig), { recursive: true })
		writeFileSync(fishConfig, `# kajji\nfish_add_path ${tmpHome}/.kajji/bin\n`)

		const found = findShellConfig(
			{ SHELL: "/usr/local/bin/fish", XDG_CONFIG_HOME: xdg },
			tmpHome,
		)
		expect(found).toBe(fishConfig)
	})

	test("falls through to bash candidates for unknown shells", () => {
		const profile = join(tmpHome, ".profile")
		writeFileSync(profile, `# kajji\nexport PATH=${tmpHome}/.kajji/bin:$PATH\n`)

		const found = findShellConfig({ SHELL: "/bin/dash" }, tmpHome)
		expect(found).toBe(profile)
	})

	test("returns null when no candidate references kajji", () => {
		const zshrc = join(tmpHome, ".zshrc")
		writeFileSync(zshrc, "export FOO=1\n")
		const found = findShellConfig({ SHELL: "/bin/zsh" }, tmpHome)
		expect(found).toBeNull()
	})
})

// Local helper to avoid importing path.dirname in test file body twice.
function dirname(p: string): string {
	const idx = p.lastIndexOf("/")
	return idx === -1 ? "." : p.slice(0, idx)
}
