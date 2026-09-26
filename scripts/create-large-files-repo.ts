import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"

const MiB = 1024 * 1024

function jj(repository: string, ...args: string[]) {
    const result = Bun.spawnSync(
        ["jj", "--config", "user.name=Kajji", "--config", "user.email=kajji@example.com", ...args],
        { cwd: repository, stderr: "pipe" },
    )
    if (result.exitCode !== 0) throw new Error(`jj ${args.join(" ")}: ${result.stderr}`)
}

/**
 * Create a jj repository whose working copy has new files above jj's default
 * `snapshot.max-new-file-size` (1 MiB), so jj refuses to snapshot them.
 */
export async function createLargeFilesRepository(): Promise<string> {
    const repository = await mkdtemp(join("/tmp", "kajji-large-files-repo-"))

    jj(repository, "git", "init", "--colocate")
    await writeFile(join(repository, "README.md"), "# Large files fixture\n")
    jj(repository, "describe", "-m", "Initial commit")
    jj(repository, "new")

    // Tracked and refused files side by side, some in the same folder.
    // Random bytes: if you track a large file, kajji shows a binary file, not a huge text diff.
    await mkdir(join(repository, "assets"), { recursive: true })
    await mkdir(join(repository, "src"), { recursive: true })
    await Promise.all([
        // Tracked: a modified file, new text files, and binaries below the limit.
        writeFile(join(repository, "README.md"), "# Large files fixture\n\nSee assets/.\n"),
        writeFile(join(repository, "notes.txt"), "Small file that jj tracks.\n"),
        writeFile(join(repository, "src", "app.ts"), 'export const app = "kajji"\n'),
        writeFile(
            join(repository, "assets", "icon.svg"),
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>\n',
        ),
        writeFile(join(repository, "assets", "thumbnail.png"), randomBytes(48 * 1024)),
        writeFile(join(repository, "assets", "poster.jpg"), randomBytes(900 * 1024)),
        // Refused: above the limit.
        writeFile(join(repository, "assets", "video.mov"), randomBytes(2 * MiB)),
        writeFile(join(repository, "dump.bin"), randomBytes(3 * MiB)),
    ])

    return repository
}

if (import.meta.main) {
    const repository = await createLargeFilesRepository()
    console.log(`Repository: ${repository}`)
    console.log(`Open kajji: bun cli ${JSON.stringify(repository)}`)
}
