import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber } from "effect"
import {
    InteractiveProcess,
    InteractiveProcessLive,
    InteractiveProcessSpawnError,
} from "../../../src/process/interactive-process"

const tempDirs: string[] = []

function makeTempDir() {
    const directory = mkdtempSync(join(tmpdir(), "kajji-interactive-test-"))
    tempDirs.push(directory)
    return directory
}

async function waitForFile(path: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            return readFileSync(path, "utf8")
        } catch {
            await Bun.sleep(10)
        }
    }
    throw new Error(`Timed out waiting for ${path}`)
}

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        rmSync(directory, { recursive: true, force: true })
    }
})

describe("InteractiveProcess", () => {
    test("returns normal non-zero exits", async () => {
        const result = await Effect.runPromise(
            InteractiveProcess.use((interactiveProcess) =>
                interactiveProcess.run({
                    executable: Bun.which("sh") ?? "/bin/sh",
                    args: ["-c", "exit 7"],
                    cwd: process.cwd(),
                }),
            ).pipe(Effect.provide(InteractiveProcessLive)),
        )

        expect(result.exitCode).toBe(7)
        expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    test("reports spawn failures as typed lifecycle errors", async () => {
        const effect = InteractiveProcess.use((interactiveProcess) =>
            interactiveProcess.run({
                executable: "/definitely/missing/kajji-interactive-command",
                args: [],
                cwd: process.cwd(),
            }),
        ).pipe(Effect.provide(InteractiveProcessLive))

        await expect(Effect.runPromise(effect)).rejects.toBeInstanceOf(
            InteractiveProcessSpawnError,
        )
    })

    test("fiber interruption terminates and reaps the child", async () => {
        const directory = makeTempDir()
        const ready = join(directory, "ready")
        const settled = join(directory, "settled")
        const script = `
            import { writeFileSync } from "node:fs"
            writeFileSync(${JSON.stringify(ready)}, String(process.pid))
            process.on("SIGTERM", () => {
                writeFileSync(${JSON.stringify(settled)}, "settled")
                process.exit(0)
            })
            setInterval(() => {}, 1000)
        `
        const effect = InteractiveProcess.use((interactiveProcess) =>
            interactiveProcess.run({
                executable: Bun.which("bun") ?? process.execPath,
                args: ["-e", script],
                cwd: directory,
            }),
        ).pipe(Effect.provide(InteractiveProcessLive))
        const fiber = Effect.runFork(effect)

        expect(await waitForFile(ready)).toMatch(/^\d+$/)
        await Effect.runPromise(Fiber.interrupt(fiber))
        expect(await waitForFile(settled)).toBe("settled")
    })
})
