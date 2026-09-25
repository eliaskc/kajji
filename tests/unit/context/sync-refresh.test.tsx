import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Effect } from "effect"
import { createEffect } from "solid-js"
import { makeApplicationClient } from "../../../src/application/client"
import { ApplicationProvider } from "../../../src/context/application"
import { FocusProvider } from "../../../src/context/focus"
import { LayoutProvider } from "../../../src/context/layout"
import { SyncProvider, useSync } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import type { ProcessCommand } from "../../../src/process/app-process"
import { makeAppProcessFake } from "../../support/layers"

for (const seeded of [false, true]) {
    test(`sync ${seeded ? "reuses bootstrap state" : "snapshots when bootstrap state is absent"} before reading`, async () => {
        const calls: ProcessCommand[] = []
        let operationId = "initial-operation"
        const app = makeApplicationClient(
            makeAppProcessFake((command) => {
                calls.push(command)
                return Effect.succeed({
                    stdout:
                        command.args[0] === "op"
                            ? operationId
                            : command.args.includes("commit_id")
                              ? "commit-id"
                              : "",
                    stderr: "",
                    exitCode: 0,
                    durationMs: 1,
                })
            }),
        )
        const ready = Promise.withResolvers<void>()
        let sync: ReturnType<typeof useSync> | undefined
        function Probe() {
            sync = useSync()
            const current = sync
            let loaded = false
            createEffect(() => {
                if (current.loading()) loaded = true
                else if (loaded) ready.resolve()
            })
            return <text>refresh test</text>
        }
        const setup = await testRender(
            () => (
                <ApplicationProvider app={app}>
                    <ThemeProvider>
                        <FocusProvider>
                            <LayoutProvider>
                                <SyncProvider
                                    initialRefreshState={
                                        seeded
                                            ? { operationId, workingCopyCommitId: "commit-id" }
                                            : undefined
                                    }
                                >
                                    <Probe />
                                </SyncProvider>
                            </LayoutProvider>
                        </FocusProvider>
                    </ThemeProvider>
                </ApplicationProvider>
            ),
            { width: 80, height: 24 },
        )
        try {
            await ready.promise
            await setup.renderOnce()
            expect(sync).toBeDefined()
            expect(calls.filter((command) => command.args[0] === "op")).toHaveLength(seeded ? 0 : 1)
            const reads = calls.filter((command) => command.args.includes("--at-operation"))
            expect(reads.length).toBeGreaterThanOrEqual(2)
            expect(reads.every((command) => command.args.includes(operationId))).toBe(true)
            calls.length = 0
            operationId = "next-operation"
            await sync?.refresh()
            expect(calls[0]?.args[0]).toBe("op")
            expect(calls.filter((command) => command.args[0] === "op")).toHaveLength(1)
            expect(calls.slice(1).every((command) => command.args.includes(operationId))).toBe(true)
            expect(sync?.readOptions().atOperation).toBe(operationId)
        } finally {
            setup.renderer.destroy()
            await app.dispose()
        }
    })
}
