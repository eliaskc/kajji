import {
    existsSync,
    readFileSync,
    readdirSync,
    rmSync,
    rmdirSync,
    writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { stdin as input, stdout as output } from "node:process"
import { createInterface } from "node:readline/promises"
import { $ } from "bun"
import { defineCommand } from "citty"
import { type PackageManager, detectPackageManager } from "../utils/update"

interface RemovalTarget {
    path: string
    label: string
    keep: boolean
}

const HOMEBREW_TAP = "eliaskc/tap"

const configDir = join(homedir(), ".config", "kajji")
const stateDir = join(homedir(), ".local", "state", "kajji")
const nativeBinDir = join(homedir(), ".kajji", "bin")
const nativeRoot = join(homedir(), ".kajji")

export const uninstallCommand = defineCommand({
    meta: {
        name: "uninstall",
        description: "Uninstall kajji and remove related files",
    },
    args: {
        "keep-config": {
            type: "boolean",
            description: "Keep configuration files",
            default: false,
        },
        "keep-data": {
            type: "boolean",
            description: "Keep state data such as recent repos and comments",
            default: false,
        },
        "dry-run": {
            type: "boolean",
            description: "Show what would be removed without removing anything",
            default: false,
        },
        force: {
            type: "boolean",
            alias: "f",
            description: "Skip confirmation prompt",
            default: false,
        },
    },
    async run({ args }) {
        const pm = await detectPackageManager()
        console.log("Uninstall kajji")
        console.log(`Installation method: ${pm}`)
        console.log("")

        const targets: RemovalTarget[] = [
            { path: configDir, label: "Config", keep: args["keep-config"] },
            { path: stateDir, label: "State", keep: args["keep-data"] },
        ]
        const shellConfig = pm === "curl" ? findShellConfig() : null
        const packageCommand = getUninstallCommand(pm)

        printSummary(targets, shellConfig, packageCommand, pm)

        if (args["dry-run"]) {
            console.log("\nDry run - no changes made")
            return
        }

        if (!args.force) {
            const rl = createInterface({ input, output })
            const answer = await rl.question(
                "\nUninstall kajji? [y/N] (use --force to skip this prompt) ",
            )
            rl.close()
            if (!/^y(es)?$/i.test(answer.trim())) {
                console.log("Cancelled")
                return
            }
        }

        for (const target of targets) {
            if (target.keep) {
                console.log(`Skipping ${target.label}`)
                continue
            }
            if (!existsSync(target.path)) continue
            rmSync(target.path, { recursive: true, force: true })
            console.log(`Removed ${target.label}: ${shorten(target.path)}`)
        }

        if (shellConfig) {
            cleanShellConfig(shellConfig)
            console.log(`Cleaned PATH entry from ${shorten(shellConfig)}`)
        }

        if (packageCommand) {
            await runPackageManagerUninstall(pm, packageCommand)
        } else if (pm === "curl") {
            removeStandaloneBinary()
        } else {
            console.log(
                "\nCould not detect package manager. Remove the binary manually if needed:",
            )
            console.log(`  ${process.execPath}`)
        }

        console.log("\nDone")
    },
})

function printSummary(
    targets: RemovalTarget[],
    shellConfig: string | null,
    packageCommand: string[] | null,
    pm: PackageManager,
) {
    console.log("The following will be removed:")
    for (const target of targets) {
        if (!existsSync(target.path)) continue
        const prefix = target.keep ? "○" : "✓"
        const suffix = target.keep ? " (keeping)" : ""
        console.log(
            `  ${prefix} ${target.label}: ${shorten(target.path)}${suffix}`,
        )
    }
    if (shellConfig)
        console.log(`  ✓ Shell PATH entry: ${shorten(shellConfig)}`)
    if (packageCommand) console.log(`  ✓ Package: ${packageCommand.join(" ")}`)
    if (pm === "brew")
        console.log(`  ✓ Homebrew tap: ${HOMEBREW_TAP} (if unused)`)
    if (pm === "curl") console.log(`  ✓ Binary: ${shorten(process.execPath)}`)
}

export function getUninstallCommand(pm: PackageManager): string[] | null {
    switch (pm) {
        case "brew":
            return ["brew", "uninstall", "kajji"]
        case "npm":
            return ["npm", "uninstall", "-g", "kajji"]
        case "bun":
            return ["bun", "remove", "-g", "kajji"]
        case "pnpm":
            return ["pnpm", "uninstall", "-g", "kajji"]
        case "yarn":
            return ["yarn", "global", "remove", "kajji"]
        default:
            return null
    }
}

async function runPackageManagerUninstall(
    pm: PackageManager,
    command: string[],
): Promise<void> {
    console.log(`Running ${command.join(" ")}...`)
    const result = await $`${command}`.quiet().nothrow()
    if (result.exitCode !== 0) {
        const stderr = result.stderr
            .toString()
            .trim()
            .split("\n")
            .slice(-3)
            .join("\n")
        console.warn(
            `Package manager uninstall failed (exit ${result.exitCode}). Run manually: ${command.join(" ")}`,
        )
        if (stderr) console.warn(stderr)
        return
    }
    if (pm === "brew") await tryUntapHomebrew()
}

async function tryUntapHomebrew(): Promise<void> {
    const taps = await $`brew tap`.quiet().nothrow().text()
    if (!taps.split("\n").includes(HOMEBREW_TAP)) return
    const result = await $`brew untap ${HOMEBREW_TAP}`.quiet().nothrow()
    if (result.exitCode === 0) {
        console.log(`Removed Homebrew tap: ${HOMEBREW_TAP}`)
    } else {
        // Untap fails if the tap still has installed formulae — that's fine,
        // the user has other things from this tap and we leave it alone.
        console.log(
            `Homebrew tap '${HOMEBREW_TAP}' still in use; left in place. Remove with: brew untap ${HOMEBREW_TAP}`,
        )
    }
}

function removeStandaloneBinary(): void {
    const binaryPath = process.execPath
    try {
        rmSync(binaryPath, { force: true })
        console.log(`Removed binary: ${shorten(binaryPath)}`)
    } catch (err) {
        console.warn(
            `Failed to remove binary at ${shorten(binaryPath)}: ${(err as Error).message}`,
        )
        console.warn(`Run manually: rm "${binaryPath}"`)
        return
    }
    // Walk up and remove empty parent dirs we own (~/.kajji/bin, ~/.kajji).
    for (const dir of [dirname(binaryPath), nativeRoot]) {
        if (!dir.startsWith(nativeRoot)) continue
        removeIfEmpty(dir)
    }
}

function removeIfEmpty(dir: string): void {
    if (!existsSync(dir)) return
    try {
        const entries = readdirSync(dir)
        if (entries.length === 0) {
            // rmdirSync, not rmSync — Bun 1.3.x throws EFAULT for the latter on
            // macOS when called with { recursive: false }.
            rmdirSync(dir)
            console.log(`Removed empty directory: ${shorten(dir)}`)
        }
    } catch {
        // Best-effort cleanup; ignore.
    }
}

// Keep this list in sync with the installer's path-modification logic in
// site/public/install.sh.
export function findShellConfig(
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir(),
): string | null {
    const shell = basename(env.SHELL || "")
    const xdgConfig = env.XDG_CONFIG_HOME || join(home, ".config")
    const candidates: Record<string, string[]> = {
        fish: [join(xdgConfig, "fish", "config.fish")],
        zsh: [
            join(home, ".zshrc"),
            join(home, ".zshenv"),
            join(home, ".zprofile"),
        ],
        bash: [
            join(home, ".bashrc"),
            join(home, ".bash_profile"),
            join(home, ".profile"),
        ],
    }
    const homeBinDir = join(home, ".kajji", "bin")
    for (const file of candidates[shell] ?? candidates.bash ?? []) {
        if (!existsSync(file)) continue
        const content = readFileSync(file, "utf-8")
        if (content.includes("# kajji") || content.includes(homeBinDir)) {
            return file
        }
    }
    return null
}

/**
 * Removes the `# kajji` marker line and the immediately-following PATH line
 * the installer added. Conservative: never touches lines that aren't directly
 * adjacent to a marker, even if they happen to mention `~/.kajji/bin`.
 * Preserves the file's original trailing-newline state.
 */
export function cleanShellConfigContent(
    content: string,
    binDir: string = nativeBinDir,
): string {
    const hadTrailingNewline = content.endsWith("\n")
    const lines = content.split("\n")
    if (hadTrailingNewline) lines.pop() // drop the empty element from split

    const filtered: string[] = []
    let i = 0
    while (i < lines.length) {
        const line = lines[i] ?? ""
        if (line.trim() === "# kajji") {
            const next = lines[i + 1]
            const nextIsKajjiPath =
                next != null &&
                (next.includes(binDir) || next.includes("fish_add_path"))
            if (nextIsKajjiPath) {
                // Also drop the blank separator line the installer prepends.
                if (filtered.at(-1)?.trim() === "") filtered.pop()
                i += 2
                continue
            }
        }
        filtered.push(line)
        i++
    }
    while (filtered.at(-1)?.trim() === "") filtered.pop()

    const body = filtered.join("\n")
    return hadTrailingNewline ? `${body}\n` : body
}

function cleanShellConfig(file: string) {
    writeFileSync(file, cleanShellConfigContent(readFileSync(file, "utf-8")))
}

function shorten(path: string) {
    return path.startsWith(homedir()) ? path.replace(homedir(), "~") : path
}
