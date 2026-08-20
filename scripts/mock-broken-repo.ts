import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createBrokenRepository } from "./create-broken-repo"

const slow = process.argv.includes("--slow")
const repository = await createBrokenRepository()
let wrapperDirectory: string | undefined

try {
    let path = process.env.PATH
    if (slow) {
        const realJj = Bun.which("jj")
        if (!realJj) throw new Error("jj was not found on PATH")

        wrapperDirectory = await mkdtemp(join("/tmp", "kajji-slow-jj-"))
        const wrapperPath = join(wrapperDirectory, "jj")
        await writeFile(
            wrapperPath,
            `#!/bin/sh\nif [ "$1" = "git" ] && [ "$2" = "init" ]; then sleep 2; fi\nexec ${JSON.stringify(realJj)} "$@"\n`,
        )
        await chmod(wrapperPath, 0o755)
        path = `${wrapperDirectory}:${path}`
    }

    const child = Bun.spawn([process.execPath, "cli", repository], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: path },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    })
    process.exitCode = await child.exited
} finally {
    if (wrapperDirectory) {
        await rm(wrapperDirectory, { recursive: true, force: true })
    }
}

console.log(`Broken repository fixture remains at:\n${repository}`)
console.log(`Remove it with:\nrm -rf ${JSON.stringify(repository)}`)
