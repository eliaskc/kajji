import { mkdir, open, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Context, Data, Effect, Layer } from "effect"
import {
    type PersistedStackState,
    readPersistedStackState,
    writePersistedStackState,
} from "./state"

export type StackJournalEntry = Readonly<Record<string, unknown>>

export interface StackJournal {
    readonly version: 1
    readonly id: string
    readonly kind: "sync"
    readonly stackRootName: string
    readonly beforeOperationId: string
    afterOperationId?: string
    readonly createdAt: string
    readonly entries: StackJournalEntry[]
}

export class StackStoreError extends Data.TaggedError("StackStoreError")<{
    readonly operation: "read-state" | "write-state" | "write-journal"
    readonly cause: unknown
}> {
    override get message() {
        return this.cause instanceof Error
            ? this.cause.message
            : String(this.cause)
    }
}

export interface StackStoreService {
    readonly readState: (
        repositoryRoot: string,
    ) => Effect.Effect<PersistedStackState, StackStoreError>
    readonly writeState: (
        repositoryRoot: string,
        state: PersistedStackState,
    ) => Effect.Effect<void, StackStoreError>
    readonly writeJournal: (
        repositoryRoot: string,
        journal: StackJournal,
    ) => Effect.Effect<void, StackStoreError>
}

export class StackStore extends Context.Service<
    StackStore,
    StackStoreService
>()("kajji/StackStore") {}

async function durableWrite(path: string, contents: string): Promise<void> {
    const directory = dirname(path)
    await mkdir(directory, { recursive: true })
    const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, contents)
    const temporary = await open(temporaryPath, "r")
    try {
        await temporary.sync()
    } finally {
        await temporary.close()
    }
    await rename(temporaryPath, path)
    const directoryHandle = await open(directory, "r")
    try {
        await directoryHandle.sync()
    } finally {
        await directoryHandle.close()
    }
}

function journalPath(repositoryRoot: string, journalId: string): string {
    const cacheHome =
        process.env.XDG_CACHE_HOME || `${process.env.HOME ?? ""}/.cache`
    const repositoryKey = Buffer.from(repositoryRoot).toString("base64url")
    return `${cacheHome}/kajji/stack-journal/${repositoryKey}/${journalId}.json`
}

export const StackStoreLive = Layer.succeed(
    StackStore,
    StackStore.of({
        readState: Effect.fn("StackStore.readState")((repositoryRoot) =>
            Effect.tryPromise({
                try: () => readPersistedStackState(repositoryRoot),
                catch: (cause) =>
                    new StackStoreError({ operation: "read-state", cause }),
            }),
        ),
        writeState: Effect.fn("StackStore.writeState")(
            (repositoryRoot, state) =>
                Effect.tryPromise({
                    try: () => writePersistedStackState(state, repositoryRoot),
                    catch: (cause) =>
                        new StackStoreError({
                            operation: "write-state",
                            cause,
                        }),
                }),
        ),
        writeJournal: Effect.fn("StackStore.writeJournal")(
            (repositoryRoot, journal) =>
                Effect.tryPromise({
                    try: () =>
                        durableWrite(
                            journalPath(repositoryRoot, journal.id),
                            `${JSON.stringify(journal, null, 2)}\n`,
                        ),
                    catch: (cause) =>
                        new StackStoreError({
                            operation: "write-journal",
                            cause,
                        }),
                }),
        ),
    }),
)
