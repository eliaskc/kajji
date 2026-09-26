import { createLargeFilesRepository } from "./create-large-files-repo"

const repository = await createLargeFilesRepository()

const child = Bun.spawn([process.execPath, "cli", repository], {
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
})
process.exitCode = await child.exited

console.log(`Repository: ${repository}`)
