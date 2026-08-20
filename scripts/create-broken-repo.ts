import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"

export interface BrokenRepositoryOptions {
    /** Keep a healthy colocated `.git` with one commit, and break only `.jj`. */
    readonly jjOnly?: boolean
}

function git(repository: string, ...args: string[]) {
    const result = Bun.spawnSync(["git", ...args], { cwd: repository, stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
}

export async function createBrokenRepository(
    options: BrokenRepositoryOptions = {},
): Promise<string> {
    const repository = await mkdtemp(join("/tmp", "kajji-broken-repo-"))

    await Promise.all([
        mkdir(join(repository, ".jj", "repo", "store", "extra"), { recursive: true }),
        mkdir(join(repository, ".jj", "repo", "op_store", "operations"), {
            recursive: true,
        }),
        writeFile(join(repository, "README.md"), "# Broken repository fixture\n"),
    ])
    if (options.jjOnly) {
        git(repository, "init", "--quiet")
        git(repository, "add", "README.md")
        git(
            repository,
            "-c",
            "user.name=Kajji",
            "-c",
            "user.email=kajji@example.com",
            "commit",
            "--quiet",
            "-m",
            "Initial commit",
        )
    } else {
        await Promise.all([
            mkdir(join(repository, ".git", "objects"), { recursive: true }),
            mkdir(join(repository, ".git", "refs"), { recursive: true }),
        ])
    }

    return repository
}

if (import.meta.main) {
    const repository = await createBrokenRepository({ jjOnly: process.argv.includes("--jj-only") })
    console.log(`Created broken repository fixture:\n${repository}\n`)
    console.log(`Run Kajji with:\nbun cli ${JSON.stringify(repository)}\n`)
    console.log(`Remove the fixture with:\nrm -rf ${JSON.stringify(repository)}`)
}
