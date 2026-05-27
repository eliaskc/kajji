import { getRepoPath } from "../repo"
import type { ExecuteResult } from "./executor"
import type { CommandObserver, OperationRunOptions } from "./observer"
import type { OperationResult } from "./operations"

async function readGhOutput(
    command: string,
    proc: ReturnType<typeof Bun.spawn>,
    observer?: CommandObserver,
): Promise<Pick<ExecuteResult, "stdout" | "stderr"> & { logId?: string }> {
    const logId = observer?.start(command, { kind: "shell" })
    let stdout = ""
    let stderr = ""

    const stdoutStream = proc.stdout as ReadableStream<Uint8Array>
    const stderrStream = proc.stderr as ReadableStream<Uint8Array>

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
                observer.append(logId, chunk)
            }
            const tail = decoder.decode()
            if (tail) {
                append(tail)
                observer.append(logId, tail)
            }
        }

        await Promise.all([
            readStream(stdoutStream, (chunk) => {
                stdout += chunk
            }),
            readStream(stderrStream, (chunk) => {
                stderr += chunk
            }),
        ])
    } else {
        ;[stdout, stderr] = await Promise.all([
            new Response(stdoutStream).text(),
            new Response(stderrStream).text(),
        ])
    }

    return { stdout, stderr, logId }
}

function finishObservedGhCommand(
    observer: CommandObserver | undefined,
    logId: string | undefined,
    result: OperationResult,
) {
    if (logId) observer?.finish(logId, result)
}

export interface GitHubPullRequestSummary {
    number: number
    headRefName: string
    baseRefName?: string
    state?: string
    merged?: boolean
    updatedAt?: string
    createdAt?: string
}

export function parseGhRepositoryJson(stdout: string): {
    owner: string
    name: string
} {
    const value = JSON.parse(stdout) as unknown
    if (!value || typeof value !== "object") {
        throw new Error("Invalid gh repo view response")
    }
    const record = value as Record<string, unknown>
    const owner = record.owner
    if (!owner || typeof owner !== "object") {
        throw new Error("Invalid gh repo owner response")
    }
    const ownerLogin = (owner as Record<string, unknown>).login
    if (typeof ownerLogin !== "string" || typeof record.name !== "string") {
        throw new Error("Invalid gh repo view response")
    }
    return { owner: ownerLogin, name: record.name }
}

export function parseGhPullRequestsByHeadGraphqlJson(
    stdout: string,
): Map<string, GitHubPullRequestSummary> {
    return parseGhPullRequestsByHeadGraphqlJsonInternal(stdout, false)
}

export function parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(
    stdout: string,
): Map<string, GitHubPullRequestSummary> {
    return parseGhPullRequestsByHeadGraphqlJsonInternal(stdout, true)
}

function parseGhPullRequestsByHeadGraphqlJsonInternal(
    stdout: string,
    includeClosed: boolean,
): Map<string, GitHubPullRequestSummary> {
    const value = JSON.parse(stdout) as unknown
    if (!value || typeof value !== "object") return new Map()
    const data = (value as Record<string, unknown>).data
    if (!data || typeof data !== "object") return new Map()
    const repository = (data as Record<string, unknown>).repository
    if (!repository || typeof repository !== "object") return new Map()

    const pulls = new Map<string, GitHubPullRequestSummary>()
    for (const connection of Object.values(
        repository as Record<string, unknown>,
    )) {
        if (!connection || typeof connection !== "object") continue
        const record = connection as Record<string, unknown>
        const pullConnection = record.associatedPullRequests ?? connection
        if (!pullConnection || typeof pullConnection !== "object") continue
        const nodes = (pullConnection as Record<string, unknown>).nodes
        if (!Array.isArray(nodes)) continue
        for (const node of nodes) {
            if (!node || typeof node !== "object") continue
            const record = node as Record<string, unknown>
            if (typeof record.number !== "number") continue
            if (typeof record.headRefName !== "string") continue
            if (
                !includeClosed &&
                typeof record.state === "string" &&
                record.state !== "OPEN"
            ) {
                continue
            }
            const summary = {
                number: record.number,
                headRefName: record.headRefName,
                ...(typeof record.baseRefName === "string"
                    ? { baseRefName: record.baseRefName }
                    : {}),
                ...(typeof record.state === "string"
                    ? { state: record.state }
                    : {}),
                ...(typeof record.merged === "boolean"
                    ? { merged: record.merged }
                    : {}),
                ...(typeof record.updatedAt === "string"
                    ? { updatedAt: record.updatedAt }
                    : {}),
                ...(typeof record.createdAt === "string"
                    ? { createdAt: record.createdAt }
                    : {}),
            } satisfies GitHubPullRequestSummary
            const existing = pulls.get(record.headRefName)
            if (!existing || preferPullRequest(summary, existing)) {
                pulls.set(record.headRefName, summary)
            }
        }
    }
    return pulls
}

function preferPullRequest(
    candidate: GitHubPullRequestSummary,
    existing: GitHubPullRequestSummary,
): boolean {
    const candidateTime = Date.parse(
        candidate.updatedAt ?? candidate.createdAt ?? "",
    )
    const existingTime = Date.parse(
        existing.updatedAt ?? existing.createdAt ?? "",
    )
    if (!Number.isNaN(candidateTime) && !Number.isNaN(existingTime)) {
        return candidateTime > existingTime
    }
    return candidate.number > existing.number
}

async function ghOutput(
    args: readonly string[],
    stdin?: string,
): Promise<string> {
    const proc = Bun.spawn(["gh", ...args], {
        cwd: getRepoPath(),
        stdin: stdin === undefined ? "ignore" : "pipe",
        stdout: "pipe",
        stderr: "pipe",
    })
    if (stdin !== undefined && proc.stdin) {
        proc.stdin.write(stdin)
        proc.stdin.end()
    }
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
        new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
        proc.exited,
    ])
    if (exitCode !== 0) throw new Error(stderr || stdout || "gh command failed")
    return stdout
}

export async function ghListPullRequestsByHead(
    heads: readonly string[] = [],
    options: { includeClosed?: boolean } = {},
): Promise<Map<string, GitHubPullRequestSummary>> {
    const uniqueHeads = [...new Set(heads)].filter(Boolean)
    if (uniqueHeads.length === 0) return new Map()

    const repo = parseGhRepositoryJson(
        await ghOutput(["repo", "view", "--json", "owner,name"]),
    )
    const states = options.includeClosed ? "[OPEN, CLOSED, MERGED]" : "OPEN"
    const query = `query PullRequestsByHead($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
${uniqueHeads
    .map(
        (head, index) =>
            `    h${index}: ref(qualifiedName: ${JSON.stringify(
                `refs/heads/${head}`,
            )}) { associatedPullRequests(first: 20, states: ${states}) { nodes { number headRefName baseRefName state merged updatedAt createdAt } } }
    p${index}: pullRequests(first: 20, states: ${states}, headRefName: ${JSON.stringify(
        head,
    )}) { nodes { number headRefName baseRefName state merged updatedAt createdAt } }`,
    )
    .join("\n")}
  }
}`
    const stdout = await ghOutput([
        "api",
        "graphql",
        "-f",
        `owner=${repo.owner}`,
        "-f",
        `name=${repo.name}`,
        "-f",
        `query=${query}`,
    ])
    return options.includeClosed
        ? parseGhPullRequestsByHeadGraphqlJsonIncludingClosed(stdout)
        : parseGhPullRequestsByHeadGraphqlJson(stdout)
}

export async function ghPrCreateWeb(
    head: string,
    options?: OperationRunOptions,
): Promise<OperationResult> {
    const args = ["pr", "create", "--web", "--head", head]
    const command = `gh ${args.join(" ")}`

    try {
        const proc = Bun.spawn(["gh", ...args], {
            cwd: getRepoPath(),
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        })

        const { stdout, stderr, logId } = await readGhOutput(
            command,
            proc,
            options?.observer,
        )
        const exitCode = await proc.exited
        const result = {
            stdout,
            stderr,
            exitCode,
            success: exitCode === 0,
            command,
            logged: Boolean(logId),
        }
        finishObservedGhCommand(options?.observer, logId, result)
        return result
    } catch (error) {
        return {
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            success: false,
            command,
        }
    }
}

export async function ghBrowseCommit(
    commit: string,
    options?: OperationRunOptions,
): Promise<OperationResult> {
    const args = ["browse", commit]
    const command = `gh ${args.join(" ")}`

    try {
        const proc = Bun.spawn(["gh", ...args], {
            cwd: getRepoPath(),
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        })

        const { stdout, stderr, logId } = await readGhOutput(
            command,
            proc,
            options?.observer,
        )
        const exitCode = await proc.exited
        const result = {
            stdout,
            stderr,
            exitCode,
            success: exitCode === 0,
            command,
            logged: Boolean(logId),
        }
        finishObservedGhCommand(options?.observer, logId, result)
        return result
    } catch (error) {
        return {
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            success: false,
            command,
        }
    }
}

async function ghOperation(
    args: readonly string[],
    options?: OperationRunOptions & { stdin?: string; command?: string },
): Promise<OperationResult> {
    const command = options?.command ?? `gh ${args.join(" ")}`
    try {
        const proc = Bun.spawn(["gh", ...args], {
            cwd: getRepoPath(),
            stdin: options?.stdin === undefined ? "ignore" : "pipe",
            stdout: "pipe",
            stderr: "pipe",
        })
        if (options?.stdin !== undefined && proc.stdin) {
            proc.stdin.write(options.stdin)
            proc.stdin.end()
        }
        const { stdout, stderr, logId } = await readGhOutput(
            command,
            proc,
            options?.observer,
        )
        const exitCode = await proc.exited
        const result = {
            stdout,
            stderr,
            exitCode,
            success: exitCode === 0,
            command,
            logged: Boolean(logId),
        }
        finishObservedGhCommand(options?.observer, logId, result)
        return result
    } catch (error) {
        return {
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            success: false,
            command,
        }
    }
}

export async function ghPrCreate(
    input: { head: string; base: string },
    options?: OperationRunOptions,
): Promise<OperationResult> {
    return ghOperation(
        ["pr", "create", "--head", input.head, "--base", input.base, "--fill"],
        options,
    )
}

export async function ghPrEditBase(
    prNumber: number,
    base: string,
    options?: OperationRunOptions,
): Promise<OperationResult> {
    return ghOperation(
        ["pr", "edit", String(prNumber), "--base", base],
        options,
    )
}

export async function ghPrClose(
    prNumber: number,
    options?: OperationRunOptions,
): Promise<OperationResult> {
    return ghOperation(["pr", "close", String(prNumber)], options)
}

export async function ghPrViewWeb(
    prNumber: number,
    options?: OperationRunOptions,
): Promise<OperationResult> {
    return ghOperation(["pr", "view", String(prNumber), "--web"], options)
}

export async function ghUpsertStackComment(
    prNumber: number,
    body: string,
    options?: OperationRunOptions,
): Promise<OperationResult> {
    const repo = parseGhRepositoryJson(
        await ghOutput(["repo", "view", "--json", "owner,name"]),
    )
    const marker = `<!-- kajji-stack pr=${prNumber} -->`
    const commentsJson = await ghOutput([
        "api",
        `repos/${repo.owner}/${repo.name}/issues/${prNumber}/comments`,
    ])
    const comments = JSON.parse(commentsJson) as unknown
    const existing = Array.isArray(comments)
        ? comments.find((comment) => {
              if (!comment || typeof comment !== "object") return false
              const record = comment as Record<string, unknown>
              return (
                  typeof record.body === "string" &&
                  record.body.includes(marker)
              )
          })
        : undefined
    const existingId =
        existing && typeof existing === "object"
            ? (existing as Record<string, unknown>).id
            : undefined
    if (typeof existingId === "number") {
        return ghOperation(
            [
                "api",
                "--silent",
                "--method",
                "PATCH",
                `repos/${repo.owner}/${repo.name}/issues/comments/${existingId}`,
                "-f",
                `body=${body}`,
            ],
            options,
        )
    }
    return ghOperation(
        [
            "api",
            "--silent",
            "--method",
            "POST",
            `repos/${repo.owner}/${repo.name}/issues/${prNumber}/comments`,
            "-f",
            `body=${body}`,
        ],
        options,
    )
}
