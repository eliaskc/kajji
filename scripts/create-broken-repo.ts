import { mkdir, mkdtemp } from "node:fs/promises"
import { join } from "node:path"

export async function createBrokenRepository(): Promise<string> {
    const repository = await mkdtemp(join("/tmp", "kajji-broken-repo-"))

    await Promise.all([
        mkdir(join(repository, ".jj", "repo", "store", "extra"), { recursive: true }),
        mkdir(join(repository, ".jj", "repo", "op_store", "operations"), {
            recursive: true,
        }),
        mkdir(join(repository, ".git", "objects"), { recursive: true }),
        mkdir(join(repository, ".git", "refs"), { recursive: true }),
    ])

    return repository
}

if (import.meta.main) {
    const repository = await createBrokenRepository()
    console.log(`Created broken repository fixture:\n${repository}\n`)
    console.log(`Run Kajji with:\nbun cli ${JSON.stringify(repository)}\n`)
    console.log(`Remove the fixture with:\nrm -rf ${JSON.stringify(repository)}`)
}
