import { describe, expect, test } from "bun:test"

describe("execute", () => {
    test("returns correct structure with stdout, stderr, exitCode, success", async () => {
        const result = await runCommand(["echo", "hello"])

        expect(result).toHaveProperty("stdout")
        expect(result).toHaveProperty("stderr")
        expect(result).toHaveProperty("exitCode")
        expect(result).toHaveProperty("success")
        expect(typeof result.stdout).toBe("string")
        expect(typeof result.stderr).toBe("string")
        expect(typeof result.exitCode).toBe("number")
        expect(typeof result.success).toBe("boolean")
    })

    test("captures stdout from successful command", async () => {
        const result = await runCommand(["echo", "test output"])

        expect(result.stdout.trim()).toBe("test output")
        expect(result.stderr).toBe("")
        expect(result.exitCode).toBe(0)
        expect(result.success).toBe(true)
    })

    test("captures stderr from command", async () => {
        const result = await runCommand(["bash", "-c", "echo error >&2"])

        expect(result.stderr.trim()).toBe("error")
        expect(result.exitCode).toBe(0)
    })

    test("returns success=false for non-zero exit code", async () => {
        const result = await runCommand(["bash", "-c", "exit 1"])

        expect(result.exitCode).toBe(1)
        expect(result.success).toBe(false)
    })

    test("captures custom exit codes", async () => {
        const result = await runCommand(["bash", "-c", "exit 42"])

        expect(result.exitCode).toBe(42)
        expect(result.success).toBe(false)
    })

    test("respects cwd option", async () => {
        const result = await runCommand(["pwd"], { cwd: "/tmp" })

        expect(result.stdout.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/)
        expect(result.success).toBe(true)
    })

    test("respects env option", async () => {
        const result = await runCommand(["bash", "-c", "echo $TEST_VAR"], {
            env: { TEST_VAR: "custom_value" },
        })

        expect(result.stdout.trim()).toBe("custom_value")
    })

    test("handles command with multiple arguments", async () => {
        const result = await runCommand(["echo", "arg1", "arg2", "arg3"])

        expect(result.stdout.trim()).toBe("arg1 arg2 arg3")
    })

    test("handles empty output", async () => {
        const result = await runCommand(["true"])

        expect(result.stdout).toBe("")
        expect(result.stderr).toBe("")
        expect(result.exitCode).toBe(0)
        expect(result.success).toBe(true)
    })

    test("handles command that outputs to both stdout and stderr", async () => {
        const result = await runCommand([
            "bash",
            "-c",
            "echo stdout; echo stderr >&2",
        ])

        expect(result.stdout.trim()).toBe("stdout")
        expect(result.stderr.trim()).toBe("stderr")
        expect(result.success).toBe(true)
    })
})

describe("executeWithColor", () => {
    test("prepends --color always to arguments", async () => {
        const args = ["--color", "always", "log", "-n", "5"]
        const result = await runCommand(["echo", ...args])

        expect(result.stdout.trim()).toBe("--color always log -n 5")
    })
})

interface ExecuteResult {
    stdout: string
    stderr: string
    exitCode: number
    success: boolean
}

interface ExecuteOptions {
    cwd?: string
    env?: Record<string, string>
}

async function runCommand(
    command: string[],
    options: ExecuteOptions = {},
): Promise<ExecuteResult> {
    const proc = Bun.spawn(command, {
        cwd: options.cwd,
        env: {
            ...process.env,
            ...options.env,
        },
        stdout: "pipe",
        stderr: "pipe",
    })

    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ])

    const exitCode = await proc.exited

    return {
        stdout,
        stderr,
        exitCode,
        success: exitCode === 0,
    }
}
