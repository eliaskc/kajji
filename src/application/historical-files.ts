import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export interface HistoricalFileStore {
    materialize(
        revision: string,
        paths: readonly string[],
        writeFile: (
            revision: string,
            path: string,
            outputPath: string,
        ) => Promise<void>,
    ): Promise<string[]>
    dispose(): void
}

export function makeHistoricalFileStore(): HistoricalFileStore {
    let snapshotRoot: string | null = null
    const revisionDirectories = new Map<string, string>()
    const completed = new Map<string, string>()
    const inFlight = new Map<string, Promise<string>>()

    const getSnapshotRoot = (): string => {
        snapshotRoot ??= mkdtempSync(join(tmpdir(), "kajji-revisions-"))
        return snapshotRoot
    }

    const getRevisionDirectory = (revision: string): string => {
        const existing = revisionDirectories.get(revision)
        if (existing) return existing
        const directory = join(
            getSnapshotRoot(),
            String(revisionDirectories.size),
        )
        mkdirSync(directory, { recursive: true })
        revisionDirectories.set(revision, directory)
        return directory
    }

    const snapshotPath = (revision: string, path: string): string => {
        const root = getRevisionDirectory(revision)
        const outputPath = resolve(root, path)
        const relativePath = relative(root, outputPath)
        if (
            relativePath === "" ||
            relativePath === ".." ||
            relativePath.startsWith(`..${sep}`) ||
            isAbsolute(relativePath)
        ) {
            throw new Error(`Invalid repository path: ${path}`)
        }
        return outputPath
    }

    const materializeFile = (
        revision: string,
        path: string,
        writeFile: (
            revision: string,
            path: string,
            outputPath: string,
        ) => Promise<void>,
    ): Promise<string> => {
        const key = JSON.stringify([revision, path])
        const completedPath = completed.get(key)
        if (completedPath && existsSync(completedPath)) {
            return Promise.resolve(completedPath)
        }

        const pending = inFlight.get(key)
        if (pending) return pending

        const materialization = (async () => {
            const outputPath = snapshotPath(revision, path)
            mkdirSync(dirname(outputPath), { recursive: true })
            if (existsSync(outputPath)) chmodSync(outputPath, 0o600)
            await writeFile(revision, path, outputPath)
            chmodSync(outputPath, 0o444)
            completed.set(key, outputPath)
            return outputPath
        })()
        inFlight.set(key, materialization)
        const clearInFlight = () => {
            if (inFlight.get(key) === materialization) inFlight.delete(key)
        }
        void materialization.then(clearInFlight, clearInFlight)
        return materialization
    }

    return {
        async materialize(revision, paths, writeFile) {
            const outputs: string[] = []
            for (const path of paths) {
                outputs.push(await materializeFile(revision, path, writeFile))
            }
            return outputs
        },
        dispose() {
            if (!snapshotRoot) return
            rmSync(snapshotRoot, { recursive: true, force: true })
            snapshotRoot = null
            revisionDirectories.clear()
            completed.clear()
            inFlight.clear()
        },
    }
}
