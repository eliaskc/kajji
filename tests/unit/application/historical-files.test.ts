import { afterEach, describe, expect, test } from "bun:test"
import { statSync } from "node:fs"
import { makeHistoricalFileStore } from "../../../src/application/historical-files"

const stores: ReturnType<typeof makeHistoricalFileStore>[] = []

afterEach(() => {
    for (const store of stores.splice(0)) store.dispose()
})

describe("HistoricalFileStore", () => {
    test("preserves relative paths and makes snapshots read-only", async () => {
        const store = makeHistoricalFileStore()
        stores.push(store)
        const calls: Array<{ revision: string; path: string }> = []

        const [output] = await store.materialize(
            "revision",
            ["src/file.ts"],
            async (revision, path, outputPath) => {
                calls.push({ revision, path })
                await Bun.write(outputPath, "historical contents")
            },
        )

        expect(calls).toEqual([{ revision: "revision", path: "src/file.ts" }])
        expect(output?.endsWith("/src/file.ts")).toBe(true)
        expect(await Bun.file(output ?? "").text()).toBe("historical contents")
        expect(statSync(output ?? "").mode & 0o222).toBe(0)
    })

    test("deduplicates in-flight writes and caches completed snapshots", async () => {
        const store = makeHistoricalFileStore()
        stores.push(store)
        let writes = 0
        let releaseWrite!: () => void
        const writeReleased = new Promise<void>((resolve) => {
            releaseWrite = resolve
        })
        const writeFile = async (
            _revision: string,
            _path: string,
            outputPath: string,
        ) => {
            writes++
            await writeReleased
            await Bun.write(outputPath, "contents")
        }

        const first = store.materialize("commit-id", ["file"], writeFile)
        const second = store.materialize("commit-id", ["file"], writeFile)
        expect(writes).toBe(1)
        releaseWrite()

        expect(await first).toEqual(await second)
        await store.materialize("commit-id", ["file"], writeFile)
        expect(writes).toBe(1)
    })

    test("materializes distinct paths sequentially", async () => {
        const store = makeHistoricalFileStore()
        stores.push(store)
        const started: string[] = []
        let releaseFirst!: () => void
        const firstReleased = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })

        const materialization = store.materialize(
            "commit-id",
            ["first", "second"],
            async (_revision, path, outputPath) => {
                started.push(path)
                if (path === "first") await firstReleased
                await Bun.write(outputPath, path)
            },
        )

        expect(started).toEqual(["first"])
        releaseFirst()
        await materialization
        expect(started).toEqual(["first", "second"])
    })

    test("allows filenames that begin with two dots", async () => {
        const store = makeHistoricalFileStore()
        stores.push(store)

        const [output] = await store.materialize(
            "revision",
            ["..config"],
            async (_revision, _path, outputPath) => {
                await Bun.write(outputPath, "contents")
            },
        )

        expect(output?.endsWith("/..config")).toBe(true)
    })

    test("rejects paths outside the snapshot", async () => {
        const store = makeHistoricalFileStore()
        stores.push(store)

        await expect(
            store.materialize("revision", ["../file"], async () => {}),
        ).rejects.toThrow("Invalid repository path")
    })
})
