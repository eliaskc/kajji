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
