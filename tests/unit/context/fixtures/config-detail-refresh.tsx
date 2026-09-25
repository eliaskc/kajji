import assert from "node:assert/strict"
import { setImmediate } from "node:timers/promises"
import { testRender } from "@opentui/solid"
import { Effect } from "effect"
import { makeApplicationClient, type ApplicationClient } from "../../../../src/application/client"
import type { Commit } from "../../../../src/commander/types"
import { MainArea } from "../../../../src/components/panels/MainArea"
import { readConfig, reloadConfig, writeConfig } from "../../../../src/config"
import { ApplicationProvider } from "../../../../src/context/application"
import { CommandProvider, useCommand } from "../../../../src/context/command"
import { CommandLogProvider } from "../../../../src/context/commandlog"
import { DialogProvider } from "../../../../src/context/dialog"
import { FocusProvider, useFocus } from "../../../../src/context/focus"
import { KeybindProvider } from "../../../../src/context/keybind"
import { LayoutProvider } from "../../../../src/context/layout"
import { StatusProvider } from "../../../../src/context/status"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { ThemeProvider } from "../../../../src/context/theme"
import type { ProcessCommand } from "../../../../src/process/app-process"
import { makeAppProcessFake } from "../../../support/layers"

writeConfig({ diff: { ...readConfig().diff, layout: "unified", engine: "jj-formatter" } })
const commit: Commit = {
    changeId: "change-a",
    commitId: "a".repeat(40),
    description: "config test",
    author: "Test",
    authorEmail: "test@example.com",
    timestamp: "2026-09-07",
    lines: ["config test"],
    displayLines: [{ gutter: "", content: "config test" }],
    refLine: "config test",
    isWorkingCopy: true,
    immutable: false,
    inTrunk: false,
    empty: false,
    divergent: false,
    conflict: false,
    bookmarks: [],
    workingCopies: [],
}
const patch = `diff --git a/file.txt b/file.txt
index 1234567..7654321 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old line ${"x".repeat(160)}
+new line ${"y".repeat(160)}
`
const calls: ProcessCommand[] = []
const base = makeApplicationClient(
    makeAppProcessFake((command) => {
        calls.push(command)
        return Effect.succeed({
            stdout:
                command.args[0] === "diff"
                    ? command.args.includes("--summary")
                        ? "M file.txt\n"
                        : patch
                    : command.args[0] === "log"
                      ? "config test\n---KAJJI_DETAILS_SEPARATOR---\nconfig test"
                      : "",
            stderr: "",
            exitCode: 0,
            durationMs: 1,
        })
    }),
)
const app: ApplicationClient = {
    ...base,
    jjStreamLogPage: () => ({
        result: Promise.resolve({ commits: [commit], hasMore: false }),
        cancel: () => {},
    }),
}
let sync!: ReturnType<typeof useSync>
let command!: ReturnType<typeof useCommand>
let focus!: ReturnType<typeof useFocus>
function Probe() {
    sync = useSync()
    command = useCommand()
    focus = useFocus()
    return <MainArea />
}
const setup = await testRender(
    () => (
        <ApplicationProvider app={app}>
            <ThemeProvider>
                <FocusProvider>
                    <LayoutProvider>
                        <SyncProvider
                            initialRefreshState={{
                                operationId: "operation-a",
                                workingCopyCommitId: commit.commitId,
                            }}
                        >
                            <KeybindProvider>
                                <CommandLogProvider>
                                    <StatusProvider>
                                        <DialogProvider>
                                            <CommandProvider>
                                                <Probe />
                                            </CommandProvider>
                                        </DialogProvider>
                                    </StatusProvider>
                                </CommandLogProvider>
                            </KeybindProvider>
                        </SyncProvider>
                    </LayoutProvider>
                </FocusProvider>
            </ThemeProvider>
        </ApplicationProvider>
    ),
    { width: 100, height: 36 },
)

async function flush() {
    for (let n = 0; n < 20; n++) {
        await setImmediate()
        await setup.renderOnce()
    }
}
async function waitForText(text: string) {
    for (let n = 0; n < 100; n++) {
        await flush()
        if (setup.captureCharFrame().includes(text)) return
    }
    throw new Error(`Missing ${text}:\n${setup.captureCharFrame()}`)
}
try {
    await waitForText("new line")
    await sync.enterFilesView()
    await flush()
    assert.equal(sync.flatFiles().filter((file) => !file.node.isDirectory).length, 1)
    focus.setPanel("detail")
    assert.equal(command.execute("detail.cycle_diff_engine"), true) // jj formatter -> textual
    await waitForText("new line")
    await flush()
    assert.equal(focus.activeContext(), "detail.diff_custom")
    assert.equal(command.execute("detail.toggle_diff_style"), true)
    assert.equal(command.execute("detail.toggle_diff_wrap"), true)
    await flush()
    const originalFrame = setup.captureCharFrame()
    const version = sync.refreshCounter()
    const before = calls.length
    const description = await app.jjCommitDetails(commit.commitId, sync.readOptions())
    const cachedCalls = calls.length

    for (const update of [
        () => reloadConfig(),
        () => writeConfig({ ui: { ...readConfig().ui, themeMode: "light" } }),
        () => writeConfig({ ui: { ...readConfig().ui, showFileTree: false } }),
        () => writeConfig({ whatsNewDisabled: true }),
    ]) {
        update()
        await flush()
        assert.equal(sync.refreshCounter(), version)
        assert.equal(calls.length, cachedCalls, "presentation updates must not run jj")
        assert.equal(await app.jjCommitDetails(commit.commitId, sync.readOptions()), description)
        assert.equal(setup.captureCharFrame(), originalFrame, "view overrides must survive")
    }
    assert.equal(cachedCalls, before, "selected description was already cached")
    assert.equal(sync.showTree(), false)

    // Layout and wrap changes must not clear the independent engine override.
    writeConfig({ diff: { ...readConfig().diff, layout: "split", wrap: false } })
    await flush()
    assert.equal(focus.activeContext(), "detail.diff_custom")
    assert.equal(calls.length, cachedCalls)
    assert.equal(sync.refreshCounter(), version)

    writeConfig({ diff: { ...readConfig().diff, layout: "unified", wrap: true } })
    await flush()
    assert.notEqual(setup.captureCharFrame(), originalFrame, "changed view settings must apply")
    assert.equal(calls.length, cachedCalls)

    // An actual engine setting change clears its override and selects that engine.
    writeConfig({ diff: { ...readConfig().diff, engine: "textual" } })
    await flush()
    writeConfig({ diff: { ...readConfig().diff, engine: "jj-formatter" } })
    await flush()
    assert.equal(focus.activeContext(), "detail.diff_jj_formatter")
    assert.equal(sync.refreshCounter(), version)
    console.log("config detail checks passed")
} finally {
    setup.renderer.destroy()
    await base.dispose()
}
