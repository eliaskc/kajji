import { randomBytes } from "node:crypto"
import {
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    renameSync,
    writeFileSync,
} from "node:fs"
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export function writeFileAtomic(filePath: string, content: string): void {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }

    const tempPath = `${filePath}.tmp-${randomBytes(6).toString("hex")}`
    writeFileSync(tempPath, content)
    const fd = openSync(tempPath, "r+")
    fsyncSync(fd)
    closeSync(fd)
    renameSync(tempPath, filePath)
}

export async function writeFileAtomicDurable(
    filePath: string,
    content: string,
): Promise<void> {
    const directory = dirname(filePath)
    await mkdir(directory, { recursive: true })
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`
    try {
        await writeFile(temporaryPath, content)
        const temporary = await open(temporaryPath, "r")
        try {
            await temporary.sync()
        } finally {
            await temporary.close()
        }
        await rename(temporaryPath, filePath)
        const directoryHandle = await open(directory, "r")
        try {
            await directoryHandle.sync()
        } finally {
            await directoryHandle.close()
        }
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {})
        throw error
    }
}
