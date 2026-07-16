import { getRepoPath } from "../repo"
import { diagnosticsLog } from "../utils/diagnostics"
import { profile, profileMsg } from "../utils/profiler"
import type { CommandObserver } from "./observer"

export interface ExecuteResult {
    stdout: string
    stderr: string
    exitCode: number
    success: boolean
    logged?: boolean
}

export interface ExecuteOptions {
    cwd?: string
    env?: Record<string, string>
    timeout?: number
    observer?: CommandObserver
    command?: string
}

function isInternalReadCommand(args: string[]): boolean {
    const command = args[0]
    if (command === "log" || command === "diff" || command === "show")
        return true
    if (command === "file") return true
    if (command === "bookmark" && args[1] === "list") return true
    if (command === "op" && args[1] === "log") return true
    if (command === "root") return true
    return false
}

function commandArgs(args: string[]) {
    return args[0] === "--color" ? args.slice(2) : args
}

export async function execute(
    args: string[],
    options: ExecuteOptions = {},
): Promise<ExecuteResult> {
    const startedAt = performance.now()
    const endTotal = profile(`execute [jj ${args[0]}]`)
    const endSpawn = profile("  spawn")

    const proc = Bun.spawn(["jj", ...args], {
        cwd: options.cwd || getRepoPath(),
        env: {
            ...process.env,
            // Prevent jj from opening editors
            JJ_EDITOR: "true",
            EDITOR: "true",
            VISUAL: "true",
            ...options.env,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    })
    endSpawn()

    const observer = options.observer
    const logId = observer?.start(options.command ?? `jj ${args.join(" ")}`, {
        kind: "jj",
    })

    const endRead = profile("  read stdout/stderr")
    let stdout = ""
    let stderr = ""
    if (observer && logId) {
        const readStream = async (
            stream: ReadableStream<Uint8Array>,
            append: (chunk: string) => void,
        ) => {
            const reader = stream.getReader()
            const decoder = new TextDecoder()
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const chunk = decoder.decode(value, { stream: true })
                append(chunk)
                observer?.append(logId, chunk)
            }
            const tail = decoder.decode()
            if (tail) {
                append(tail)
                observer?.append(logId, tail)
            }
        }
        await Promise.all([
            readStream(proc.stdout, (chunk) => {
                stdout += chunk
            }),
            readStream(proc.stderr, (chunk) => {
                stderr += chunk
            }),
        ])
    } else {
        ;[stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ])
    }
    endRead(`${stdout.length + stderr.length} chars`)

    const endWait = profile("  wait for exit")
    const exitCode = await proc.exited
    endWait()

    endTotal()

    const result = {
        stdout,
        stderr,
        exitCode,
        success: exitCode === 0,
        logged: Boolean(logId),
    }
    const normalizedArgs = commandArgs(args)
    const internalRead = isInternalReadCommand(normalizedArgs)
    if (!internalRead || !result.success) {
        diagnosticsLog(
            result.success ? "info" : "error",
            "jj command finished",
            {
                command: `jj ${normalizedArgs.slice(0, 2).join(" ")}`,
                cwd: options.cwd || getRepoPath(),
                durationMs: Math.round(performance.now() - startedAt),
                exitCode,
                ...(stderr ? { stderr: stderr.slice(0, 4000) } : {}),
            },
        )
    }
    if (logId) observer?.finish(logId, result)
    return result
}

export async function executeWithColor(
    args: string[],
    options: ExecuteOptions = {},
): Promise<ExecuteResult> {
    return execute(["--color", "always", ...args], options)
}

export interface StreamingExecuteCallbacks {
    onChunk: (content: string, lineCount: number, chunk: string) => void
    onComplete: (result: ExecuteResult) => void
    onError: (error: Error) => void
}

export function executeStreaming(
    args: string[],
    options: ExecuteOptions,
    callbacks: StreamingExecuteCallbacks,
): { cancel: () => void } {
    const endTotal = profile(`executeStreaming [jj ${args[0]}]`)

    const proc = Bun.spawn(["jj", ...args], {
        cwd: options.cwd || getRepoPath(),
        env: {
            ...process.env,
            JJ_EDITOR: "true",
            EDITOR: "true",
            VISUAL: "true",
            ...options.env,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    })

    let cancelled = false
    let stdout = ""
    let lineCount = 0
    let stdoutReader: ReturnType<typeof proc.stdout.getReader> | undefined
    const stderrPromise = new Response(proc.stderr).text()

    const readStream = async () => {
        try {
            const reader = proc.stdout.getReader()
            stdoutReader = reader
            const decoder = new TextDecoder()
            let chunkCount = 0

            while (!cancelled) {
                const { done, value } = await reader.read()
                if (done) break

                chunkCount++
                const chunk = decoder.decode(value, { stream: true })
                stdout += chunk

                const newLines = chunk.split("\n").length - 1
                lineCount += newLines

                profileMsg(
                    `  chunk #${chunkCount}: ${chunk.length} bytes, ${newLines} lines, total ${lineCount} lines`,
                )

                callbacks.onChunk(stdout, lineCount, chunk)

                await new Promise((r) => setImmediate(r))
            }

            const tail = decoder.decode()
            if (!cancelled && tail) {
                stdout += tail
                lineCount += tail.split("\n").length - 1
                callbacks.onChunk(stdout, lineCount, tail)
            }

            const [stderr, exitCode] = await Promise.all([
                stderrPromise,
                proc.exited,
            ])

            endTotal()

            if (!cancelled) {
                callbacks.onComplete({
                    stdout,
                    stderr,
                    exitCode,
                    success: exitCode === 0,
                })
            }
        } catch (error) {
            if (!cancelled) {
                diagnosticsLog("error", "streaming jj command failed", {
                    command: `jj ${commandArgs(args).slice(0, 2).join(" ")}`,
                    cwd: options.cwd || getRepoPath(),
                    error: error instanceof Error ? error.stack : String(error),
                })
                callbacks.onError(
                    error instanceof Error ? error : new Error(String(error)),
                )
            }
        } finally {
            stdoutReader?.releaseLock()
            stdoutReader = undefined
        }
    }

    readStream()

    return {
        cancel: () => {
            if (cancelled) return
            cancelled = true
            stdoutReader?.cancel().catch(() => {})
            proc.kill()
        },
    }
}
