import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber } from "effect"
import {
    AppProcess,
    AppProcessLive,
    ProcessSpawnError,
    ProcessTimeoutError,
} from "../../../src/process/app-process"

const tempDirs: string[] = []

function makeTempDir() {
    const directory = mkdtempSync(join(tmpdir(), "kajji-process-test-"))
    tempDirs.push(directory)
    return directory
}

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        rmSync(directory, { recursive: true, force: true })
    }
})

function run(
    script: string,
    options?: {
        cwd?: string
        env?: Record<string, string>
        timeoutMs?: number
        stdin?: string
        stdoutFile?: string
        onOutput?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>
    },
) {
    return Effect.runPromise(
        AppProcess.use((appProcess) =>
            appProcess.run({
                executable: Bun.which("bun") ?? processExecPath(),
                args: ["-e", script],
                cwd: options?.cwd ?? process.cwd(),
                env: options?.env,
                timeoutMs: options?.timeoutMs,
                stdin: options?.stdin,
                stdoutFile: options?.stdoutFile,
                onOutput: options?.onOutput,
            }),
        ).pipe(Effect.provide(AppProcessLive)),
    )
}

function processExecPath() {
    return globalThis.process.execPath
}

async function waitForFile(path: string) {
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
        try {
            return readFileSync(path, "utf8")
        } catch {
            await Bun.sleep(10)
        }
    }
    throw new Error(`Timed out waiting for ${path}`)
}

describe("AppProcess", () => {
    test("captures stdout and successful stderr concurrently", async () => {
        const result = await run(
            'process.stdout.write("out\\n"); process.stderr.write("warning\\n")',
        )

        expect(result.stdout).toBe("out\n")
        expect(result.stderr).toBe("warning\n")
        expect(result.exitCode).toBe(0)
        expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    test("writes provided stdin and closes the stream", async () => {
        const result = await run(
            "const input = await Bun.stdin.text(); process.stdout.write(input)",
            { stdin: "request body" },
        )

        expect(result.stdout).toBe("request body")
        expect(result.exitCode).toBe(0)
    })

    test("redirects stdout to a file without decoding it", async () => {
        const directory = makeTempDir()
        const output = join(directory, "output.bin")
        const result = await run(
            "process.stdout.write(new Uint8Array([0, 255, 1]))",
            { stdoutFile: output },
        )

        expect(result.stdout).toBe("")
        expect([...readFileSync(output)]).toEqual([0, 255, 1])
    })

    test("backpressures output reads until asynchronous consumers finish", async () => {
        let release: (() => void) | undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        let consuming = false
        let settled = false

        const resultPromise = run('process.stdout.write("output")', {
            onOutput: async () => {
                consuming = true
                await gate
            },
        }).finally(() => {
            settled = true
        })

        while (!consuming) await Bun.sleep(1)
        expect(settled).toBe(false)
        release?.()

        await expect(resultPromise).resolves.toMatchObject({
            stdout: "output",
            exitCode: 0,
        })
    })

    test("interrupts a process while its output consumer is backpressured", async () => {
        const directory = makeTempDir()
        const ready = join(directory, "ready")
        const settled = join(directory, "settled")
        let consuming!: () => void
        const consumingPromise = new Promise<void>((resolve) => {
            consuming = resolve
        })
        const script = `await Bun.write(${JSON.stringify(ready)}, String(process.pid)); process.on("SIGTERM", async () => { await Bun.write(${JSON.stringify(settled)}, "settled"); process.exit(0) }); process.stdout.write("output"); await new Promise(() => {})`
        const effect = AppProcess.use((appProcess) =>
            appProcess.run({
                executable: Bun.which("bun") ?? processExecPath(),
                args: ["-e", script],
                cwd: directory,
                onOutput: async () => {
                    consuming()
                    await new Promise(() => {})
                },
            }),
        ).pipe(Effect.provide(AppProcessLive))
        const fiber = Effect.runFork(effect)

        await consumingPromise
        await Effect.runPromise(Fiber.interrupt(fiber))

        expect(await waitForFile(ready)).toMatch(/^\d+$/)
        expect(await waitForFile(settled)).toBe("settled")
    })

    test("returns normal non-zero exits as results", async () => {
        const result = await run("process.exit(42)")
        expect(result.exitCode).toBe(42)
    })

    test("reports spawn failures as typed lifecycle errors", async () => {
        const effect = AppProcess.use((appProcess) =>
            appProcess.run({
                executable: "/definitely/missing/kajji-command",
                args: [],
                cwd: process.cwd(),
            }),
        ).pipe(Effect.provide(AppProcessLive))

        await expect(Effect.runPromise(effect)).rejects.toBeInstanceOf(
            ProcessSpawnError,
        )
    })

    test("honors cwd and environment overrides", async () => {
        const cwd = makeTempDir()
        const result = await run(
            "console.log(process.cwd()); console.log(process.env.KAJJI_TEST)",
            { cwd, env: { KAJJI_TEST: "present" } },
        )

        expect(result.stdout.trim().split("\n")).toEqual([
            realpathSync(cwd),
            "present",
        ])
    })

    test("timeout terminates and reaps the child", async () => {
        const directory = makeTempDir()
        const ready = join(directory, "ready")
        const settled = join(directory, "settled")
        const script = `await Bun.write(${JSON.stringify(ready)}, String(process.pid)); process.on("SIGTERM", async () => { await Bun.write(${JSON.stringify(settled)}, "settled"); process.exit(0) }); await new Promise(() => {})`

        await expect(
            run(script, { cwd: directory, timeoutMs: 100 }),
        ).rejects.toBeInstanceOf(ProcessTimeoutError)
        expect(await waitForFile(ready)).toMatch(/^\d+$/)
        expect(await waitForFile(settled)).toBe("settled")
    })

    test("fiber interruption terminates and reaps the child", async () => {
        const directory = makeTempDir()
        const ready = join(directory, "ready")
        const settled = join(directory, "settled")
        const script = `await Bun.write(${JSON.stringify(ready)}, String(process.pid)); process.on("SIGTERM", async () => { await Bun.write(${JSON.stringify(settled)}, "settled"); process.exit(0) }); await new Promise(() => {})`
        const effect = AppProcess.use((appProcess) =>
            appProcess.run({
                executable: Bun.which("bun") ?? processExecPath(),
                args: ["-e", script],
                cwd: directory,
            }),
        ).pipe(Effect.provide(AppProcessLive))
        const fiber = Effect.runFork(effect)

        expect(await waitForFile(ready)).toMatch(/^\d+$/)
        await Effect.runPromise(Fiber.interrupt(fiber))
        expect(await waitForFile(settled)).toBe("settled")
    })
})
