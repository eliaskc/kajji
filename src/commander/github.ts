export interface GitHubPullRequestSummary {
    number: number
    headRefName: string
    baseRefName?: string
    state?: string
    merged?: boolean
    updatedAt?: string
    createdAt?: string
}

export interface GitHubRepository {
    owner: string
    name: string
}

export function parseGhRepositoryJson(stdout: string): GitHubRepository {
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

export function parseGitHubRemoteUrl(
    url: string,
): GitHubRepository | undefined {
    const trimmed = url.trim()
    const match = trimmed.match(
        /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/,
    )
    const owner = match?.[1]
    const name = match?.[2]
    if (!owner || !name) return undefined
    return { owner, name }
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
    if (!value || typeof value !== "object") {
        throw new Error("Invalid gh GraphQL response")
    }
    const envelope = value as Record<string, unknown>
    if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
        throw new Error("gh GraphQL response contains errors")
    }
    const data = envelope.data
    if (!data || typeof data !== "object") {
        throw new Error("Invalid gh GraphQL data")
    }
    const repository = (data as Record<string, unknown>).repository
    if (!repository || typeof repository !== "object") {
        throw new Error("Invalid gh GraphQL repository")
    }
    const connections = Object.values(repository as Record<string, unknown>)
    if (connections.length === 0) {
        throw new Error("Invalid empty gh GraphQL repository")
    }

    const pulls = new Map<string, GitHubPullRequestSummary>()
    for (const connection of connections) {
        if (connection === null) continue
        if (typeof connection !== "object") {
            throw new Error("Invalid gh GraphQL connection")
        }
        const record = connection as Record<string, unknown>
        const pullConnection = record.associatedPullRequests ?? connection
        if (!pullConnection || typeof pullConnection !== "object") {
            throw new Error("Invalid gh pull request connection")
        }
        const nodes = (pullConnection as Record<string, unknown>).nodes
        if (!Array.isArray(nodes)) {
            throw new Error("Invalid gh pull request nodes")
        }
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
