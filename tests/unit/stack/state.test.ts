import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
    readPersistedStackState,
    stackStatePath,
    writePersistedStackState,
} from "../../../src/stack/state"
import {
    StackStore,
    StackStoreError,
    StackStoreLive,
} from "../../../src/stack/store"

async function withRepository(
    run: (repository: string) => Promise<void>,
): Promise<void> {
    const repository = await mkdtemp(join(tmpdir(), "kajji-stack-state-"))
    try {
        await run(repository)
    } finally {
        await rm(repository, { recursive: true, force: true })
    }
}

test("persisted stack state treats only a missing file as empty", async () => {
    await withRepository(async (repository) => {
        await expect(readPersistedStackState(repository)).resolves.toEqual({
            version: 1,
            entries: [],
        })

        await writePersistedStackState({ version: 1, entries: [] }, repository)
        const path = await stackStatePath(repository)
        await Bun.write(path, "{ invalid")
        await expect(
            readPersistedStackState(repository),
        ).rejects.toBeInstanceOf(Error)
        const stored = StackStore.use((store) =>
            store.readState(repository),
        ).pipe(Effect.provide(StackStoreLive))
        await expect(Effect.runPromise(stored)).rejects.toBeInstanceOf(
            StackStoreError,
        )
    })
})

test("persisted stack state validates and atomically replaces state", async () => {
    await withRepository(async (repository) => {
        const state = {
            version: 1 as const,
            entries: [
                {
                    bookmark: "feature",
                    parent: "main",
                    syncedAt: "2026-07-17T00:00:00.000Z",
                },
            ],
        }

        await writePersistedStackState(state, repository)
        await expect(readPersistedStackState(repository)).resolves.toEqual(
            state,
        )

        const path = await stackStatePath(repository)
        const invalid = JSON.stringify({ version: 1, entries: [{}] })
        await Bun.write(path, invalid)
        await expect(
            readPersistedStackState(repository),
        ).rejects.toBeInstanceOf(Error)
    })
})
