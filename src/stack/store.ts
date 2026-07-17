import { Context, Effect, Layer, Schema } from "effect"
import { writeFileAtomicDurable } from "../utils/atomic-write"
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

export class StackStoreError extends Schema.TaggedErrorClass<StackStoreError>()(
    "StackStoreError",
    {
        operation: Schema.Literals([
            "read-state",
            "write-state",
            "write-journal",
        ]),
        cause: Schema.Defect(),
    },
) {
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
                        writeFileAtomicDurable(
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
