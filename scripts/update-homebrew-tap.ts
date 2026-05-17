/**
 * Update the Homebrew tap formula for kajji.
 *
 * Two phases keep CI ordering safe:
 *
 *   --check   Clone the tap, render the formula, and verify we can commit
 *             locally. Used as a pre-flight before the GitHub release is
 *             created so a broken tap (missing token, formula error, etc.)
 *             aborts the release.
 *   --push    Re-run everything and actually push to the tap. Used after the
 *             GitHub release is published so the formula's download URLs
 *             resolve immediately and we don't open a 404 window.
 *
 * Without flags both phases run sequentially (useful for local re-runs).
 */

import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"

const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith("--"))
const flags = new Set(args.filter((a) => a.startsWith("--")))
const phase: "check" | "push" | "both" = flags.has("--check")
    ? "check"
    : flags.has("--push")
      ? "push"
      : "both"

const pkg = JSON.parse(readFileSync("package.json", "utf-8"))
const version = positional[0] || pkg.version
const tapRepo = process.env.HOMEBREW_TAP_REPO || "eliaskc/homebrew-tap"
let tapToken = process.env.HOMEBREW_TAP_TOKEN
if (!tapToken) {
    try {
        tapToken = (await $`gh auth token`.quiet().text()).trim()
    } catch {
        // Fall back to unauthenticated clone; push will require git credentials.
    }
}

// Linuxbrew is x86_64-only upstream, so we don't ship a linux-arm64 bottle.
const archivePaths = {
    darwinArm64: "dist/kajji-darwin-arm64.zip",
    darwinX64: "dist/kajji-darwin-x64.zip",
    linuxX64: "dist/kajji-linux-x64.tar.gz",
}

function sha256(path: string) {
    return createHash("sha256").update(readFileSync(path)).digest("hex")
}

const shas = {
    darwinArm64: sha256(archivePaths.darwinArm64),
    darwinX64: sha256(archivePaths.darwinX64),
    linuxX64: sha256(archivePaths.linuxX64),
}

const formula = `class Kajji < Formula
  desc "Terminal UI for Jujutsu: the rudder for your jj"
  homepage "https://github.com/eliaskc/kajji"
  version "${version}"
  license "MIT"

  depends_on "jj"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/eliaskc/kajji/releases/download/v#{version}/kajji-darwin-arm64.zip"
      sha256 "${shas.darwinArm64}"
    else
      url "https://github.com/eliaskc/kajji/releases/download/v#{version}/kajji-darwin-x64.zip"
      sha256 "${shas.darwinX64}"
    end
  end

  # Linuxbrew is x86_64-only upstream, so we ship a single Linux bottle.
  on_linux do
    url "https://github.com/eliaskc/kajji/releases/download/v#{version}/kajji-linux-x64.tar.gz"
    sha256 "${shas.linuxX64}"
  end

  def install
    bin.install "kajji"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kajji --version")
  end
end
`

async function run(doPush: boolean) {
    const workdir = mkdtempSync(join(tmpdir(), "kajji-homebrew-tap-"))
    try {
        const cloneUrl = tapToken
            ? `https://x-access-token:${tapToken}@github.com/${tapRepo}.git`
            : `https://github.com/${tapRepo}.git`

        await $`git clone ${cloneUrl} tap`.cwd(workdir)
        const tapDir = join(workdir, "tap")
        await mkdir(join(tapDir, "Formula"), { recursive: true })
        writeFileSync(join(tapDir, "Formula", "kajji.rb"), formula)

        const status = (
            await $`git status --porcelain`.cwd(tapDir).text()
        ).trim()
        if (!status) {
            console.log(`Homebrew tap already up to date for v${version}`)
            return
        }

        await $`git config user.name github-actions[bot]`.cwd(tapDir)
        await $`git config user.email 41898282+github-actions[bot]@users.noreply.github.com`.cwd(
            tapDir,
        )
        await $`git add Formula/kajji.rb`.cwd(tapDir)
        await $`git commit -m ${`Update kajji to v${version}`}`.cwd(tapDir)

        const defaultBranch = (
            await $`git symbolic-ref --short HEAD`.cwd(tapDir).text()
        ).trim()

        if (!doPush) {
            // Dry-run push validates that the token actually has write access —
            // a read-only token would clone+commit fine but fail on the real push
            // after the GitHub release is already public.
            await $`git push --dry-run origin HEAD:${defaultBranch}`.cwd(tapDir)
            console.log(
                `Pre-flight OK: ${tapRepo} Formula/kajji.rb staged for v${version} (push --dry-run succeeded, not pushed)`,
            )
            return
        }

        await $`git push origin HEAD:${defaultBranch}`.cwd(tapDir)
        console.log(`Updated ${tapRepo} Formula/kajji.rb to v${version}`)
    } finally {
        rmSync(workdir, { recursive: true, force: true })
    }
}

if (phase === "check") {
    await run(false)
} else if (phase === "push") {
    await run(true)
} else {
    await run(false)
    await run(true)
}
