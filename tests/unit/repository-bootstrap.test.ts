import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { makeApplicationClient } from "../../src/application/client"
import type { CommandObserver } from "../../src/commander/observer"
import type { ProcessCommand, ProcessResult } from "../../src/process/app-process"
import {
    RECOVERY_BACKUP_DIRECTORY,
    applyMoves,
    permanentRemovalResult,
    removeMetadataBackups,
    restoreMetadataBackups,
} from "../../src/repository-bootstrap"
import { makeAppProcessFake } from "../support/layers"

const ok: ProcessResult = { stdout: "", stderr: "", exitCode: 0, durationMs: 1 }
const brokenRepositoryError: ProcessResult = {
    ...ok,
    exitCode: 255,
    stderr: "The repository appears broken or inaccessible",
}

interface FakeRepositoryOptions {
    /** Result of the snapshot check (`jj op log`). Defaults to success when `.jj` is healthy. */
    readonly check?: (command: ProcessCommand) => ProcessResult | undefined
    /** Result of `jj git init`. Defaults to creating a healthy `.jj`. */
    readonly init?: () => ProcessResult
    readonly root?: string | null
    readonly onCommand?: (command: ProcessCommand) => void
}

function fakeRepositoryProcess(repository: string, options: FakeRepositoryOptions = {}) {
    const healthyJj = () => existsSync(join(repository, ".jj", "repo", "store", "type"))
    return makeAppProcessFake((command) => {
        options.onCommand?.(command)
        const [subcommand] = command.args
        if (command.executable === "git") {
            return Effect.succeed(
                existsSync(join(repository, ".git", "HEAD"))
                    ? { ...ok, stdout: "true\n" }
                    : { ...ok, exitCode: 128, stderr: "not a git repository" },
            )
        }
        if (subcommand === "root") {
            const root = options.root === undefined ? repository : options.root
            return Effect.succeed(
                root === null ? { ...ok, exitCode: 1 } : { ...ok, stdout: `${root}\n` },
            )
        }
        if (subcommand === "op") {
            const result = options.check?.(command)
            if (result) return Effect.succeed(result)
            return Effect.succeed(healthyJj() ? { ...ok, stdout: "op-1\n" } : brokenRepositoryError)
        }
        if (subcommand === "log") return Effect.succeed({ ...ok, stdout: "commit-1\n" })
        if (subcommand === "git") {
            if (options.init) return Effect.succeed(options.init())
            mkdirSync(join(repository, ".jj", "repo", "store"), { recursive: true })
            writeFileSync(join(repository, ".jj", "repo", "store", "type"), "git")
            return Effect.succeed(ok)
        }
        return Effect.succeed({ ...ok, exitCode: 1 })
    })
}

async function withRepository(run: (repository: string) => Promise<void>) {
    const repository = await mkdtemp(join(tmpdir(), "kajji-recovery-"))
    try {
        await run(repository)
    } finally {
        await rm(repository, { recursive: true, force: true })
    }
}

async function createBrokenMetadata(repository: string) {
    await Promise.all([mkdir(join(repository, ".jj")), mkdir(join(repository, ".git"))])
    await Promise.all([
        writeFile(join(repository, ".jj", "sentinel"), "jj"),
        writeFile(join(repository, ".git", "sentinel"), "git"),
    ])
}

function recoveryLeftovers(repository: string) {
    return readdirSync(repository).filter((name) => name.includes("kajji"))
}

describe("RepositoryBootstrap inspection", () => {
    test("does not offer recovery for a generic jj failure", async () => {
        await withRepository(async (repository) => {
            await mkdir(join(repository, ".jj", "repo", "store"), { recursive: true })
            await writeFile(join(repository, ".jj", "repo", "store", "type"), "git")
            const client = makeApplicationClient(
                fakeRepositoryProcess(repository, {
                    check: () => ({ ...ok, exitCode: 1, stderr: "permission denied" }),
                }),
            )
            try {
                const status = await client.repositoryStatus(repository)
                expect(status.brokenMetadata).toBeNull()
                expect(status.startupError).toBe("permission denied")
                await expect(client.recoverRepository(repository)).resolves.toEqual({
                    success: false,
                    error: "No broken repository metadata was found",
                })
            } finally {
                await client.dispose()
            }
        })
    })

    test("finds malformed parent metadata when inspecting a child path", async () => {
        await withRepository(async (repository) => {
            const child = join(repository, "one", "two")
            await Promise.all([mkdir(join(repository, ".jj")), mkdir(child, { recursive: true })])
            const client = makeApplicationClient(fakeRepositoryProcess(repository, { root: null }))
            try {
                const status = await client.repositoryStatus(child)
                expect(status.repoPath).toBe(repository)
                expect(status.brokenMetadata).toEqual({ jj: true, git: false })
            } finally {
                await client.dispose()
            }
        })
    })

    test("does not offer recovery while jj can open the repository", async () => {
        await withRepository(async (repository) => {
            await mkdir(join(repository, ".jj"))
            const client = makeApplicationClient(
                fakeRepositoryProcess(repository, { check: () => ({ ...ok, stdout: "op-1\n" }) }),
            )
            try {
                const status = await client.repositoryStatus(repository)
                expect(status.brokenMetadata).toBeNull()
                expect(status.isJjRepo).toBe(true)
            } finally {
                await client.dispose()
            }
        })
    })

    test("ignores a parent .jj file when looking for metadata", async () => {
        await withRepository(async (repository) => {
            const child = join(repository, "child")
            await mkdir(child)
            await writeFile(join(repository, ".jj"), "not repository metadata")
            const client = makeApplicationClient(fakeRepositoryProcess(repository, { root: null }))
            try {
                const status = await client.repositoryStatus(child)
                expect(status.repoPath).toBe(child)
                expect(status.brokenMetadata).toBeNull()
            } finally {
                await client.dispose()
            }
        })
    })

    test("does not classify marker files as broken repository directories", async () => {
        await withRepository(async (repository) => {
            await Promise.all([
                writeFile(join(repository, ".jj"), "not repository metadata"),
                writeFile(join(repository, ".git"), "gitdir: elsewhere"),
            ])
            const client = makeApplicationClient(fakeRepositoryProcess(repository, { root: null }))
            try {
                expect((await client.repositoryStatus(repository)).brokenMetadata).toBeNull()
            } finally {
                await client.dispose()
            }
        })
    })

    test("does not classify a secondary workspace as broken", async () => {
        await withRepository(async (repository) => {
            // Secondary workspaces store the main repository path in the `.jj/repo` file.
            await mkdir(join(repository, ".jj"))
            await writeFile(join(repository, ".jj", "repo"), "/elsewhere/.jj/repo")
            const client = makeApplicationClient(
                fakeRepositoryProcess(repository, { check: () => brokenRepositoryError }),
            )
            try {
                expect((await client.repositoryStatus(repository)).brokenMetadata).toBeNull()
            } finally {
                await client.dispose()
            }
        })
    })
})

describe("RepositoryBootstrap recovery", () => {
    test("backs up broken metadata inside the new .jj before any snapshot", async () => {
        await withRepository(async (repository) => {
            await createBrokenMetadata(repository)
            const leftoversDuringChecks: string[][] = []
            const client = makeApplicationClient(
                fakeRepositoryProcess(repository, {
                    check: () => {
                        leftoversDuringChecks.push(recoveryLeftovers(repository))
                        return undefined
                    },
                }),
            )
            const events: string[] = []
            let nextId = 0
            const observer: CommandObserver = {
                start: (command) => {
                    events.push(`start:${command}`)
                    return `recovery-${nextId++}`
                },
                append: (_id, chunk) => events.push(`output:${chunk.trim()}`),
                finish: (_id, result) => events.push(`finish:${result.success}`),
                skip: () => {},
            }

            try {
                await expect(client.repositoryStatus(repository)).resolves.toMatchObject({
                    isJjRepo: false,
                    hasGitRepo: false,
                    brokenMetadata: { jj: true, git: true },
                    startupError: null,
                    repoPath: repository,
                })

                const result = await client.recoverRepository(repository, { observer })

                expect(result.success).toBe(true)
                expect(result.refreshState).toEqual({
                    operationId: "op-1",
                    workingCopyCommitId: "commit-1",
                })
                expect(result.backups).toHaveLength(2)
                const [jjBackup, gitBackup] = result.backups ?? []
                expect(jjBackup).toStartWith(join(repository, ".jj", RECOVERY_BACKUP_DIRECTORY))
                expect(await readFile(join(jjBackup!, "sentinel"), "utf8")).toBe("jj")
                expect(await readFile(join(gitBackup!, "sentinel"), "utf8")).toBe("git")
                expect(existsSync(join(repository, ".git"))).toBe(false)
                expect(recoveryLeftovers(repository)).toEqual([])
                // The post-init check snapshots, so staged folders must be gone by then.
                expect(leftoversDuringChecks.at(-1)).toEqual([])
                expect(result.backupDirectory).toBe(join(jjBackup!, ".."))
                expect(events.filter((event) => event.startsWith("start:"))).toEqual([
                    "start:Move .jj and .git aside",
                    "start:jj git init",
                    "start:Back up old metadata",
                    "start:Check new repository",
                ])
                expect(events.filter((event) => event === "finish:true")).toHaveLength(4)
            } finally {
                await client.dispose()
            }
        })
    })

    test("removes old metadata after a successful recovery when requested", async () => {
        await withRepository(async (repository) => {
            await createBrokenMetadata(repository)
            const client = makeApplicationClient(fakeRepositoryProcess(repository))

            try {
                const result = await client.recoverRepository(repository, { mode: "remove" })

                expect(result).toEqual({
                    success: true,
                    refreshState: { operationId: "op-1", workingCopyCommitId: "commit-1" },
                })
                expect(recoveryLeftovers(repository)).toEqual([])
                expect(await readdir(join(repository, ".jj"))).toEqual(["repo"])
            } finally {
                await client.dispose()
            }
        })
    })

    test("restores broken metadata when initialization fails", async () => {
        await withRepository(async (repository) => {
            await createBrokenMetadata(repository)
            const client = makeApplicationClient(
                fakeRepositoryProcess(repository, {
                    init: () => {
                        mkdirSync(join(repository, ".jj"))
                        return { ...ok, exitCode: 1, stderr: "initialization failed" }
                    },
                }),
            )

            try {
                const result = await client.recoverRepository(repository)

                expect(result).toEqual({
                    success: false,
                    error: "initialization failed\nNothing was changed.",
                })
                expect(await readFile(join(repository, ".jj", "sentinel"), "utf8")).toBe("jj")
                expect(await readFile(join(repository, ".git", "sentinel"), "utf8")).toBe("git")
                expect(recoveryLeftovers(repository)).toEqual([])
            } finally {
                await client.dispose()
            }
        })
    })

    test("restores old metadata when the post-init check fails", async () => {
        await withRepository(async (repository) => {
            await createBrokenMetadata(repository)
            let initialized = false
            const client = makeApplicationClient(
                fakeRepositoryProcess(repository, {
                    check: () =>
                        initialized
                            ? { ...ok, exitCode: 1, stderr: "post-init check failed" }
                            : undefined,
                    init: () => {
                        initialized = true
                        mkdirSync(join(repository, ".jj", "repo", "store"), { recursive: true })
                        writeFileSync(join(repository, ".jj", "repo", "store", "type"), "git")
                        return ok
                    },
                }),
            )

            try {
                await expect(client.recoverRepository(repository)).resolves.toEqual({
                    success: false,
                    error: "post-init check failed\nNothing was changed.",
                })
                expect(await readFile(join(repository, ".jj", "sentinel"), "utf8")).toBe("jj")
                expect(await readFile(join(repository, ".git", "sentinel"), "utf8")).toBe("git")
                expect(existsSync(join(repository, ".jj", RECOVERY_BACKUP_DIRECTORY))).toBe(false)
                expect(recoveryLeftovers(repository)).toEqual([])
            } finally {
                await client.dispose()
            }
        })
    })

    test("passes the chosen init command to jj", async () => {
        await withRepository(async (repository) => {
            const commands: string[] = []
            const client = makeApplicationClient(
                fakeRepositoryProcess(repository, {
                    onCommand: (command) => {
                        if (command.args[0] === "git") commands.push(command.args.join(" "))
                    },
                }),
            )
            try {
                await createBrokenMetadata(repository)
                await client.recoverRepository(repository, { mode: "remove" })
                await rm(join(repository, ".jj"), { recursive: true })
                await createBrokenMetadata(repository)
                await client.recoverRepository(repository, { mode: "remove", colocate: true })
                expect(commands).toEqual(["git init", "git init --colocate"])
            } finally {
                await client.dispose()
            }
        })
    })

    test.skipIf(!Bun.which("jj"))(
        "keeps backups out of the working-copy commit with real jj",
        async () => {
            await withRepository(async (repository) => {
                await createBrokenMetadata(repository)
                await mkdir(join(repository, ".git", "objects"))
                await writeFile(join(repository, ".git", "objects", "pack"), "old objects")
                await writeFile(join(repository, "file.txt"), "content")
                const config = join(repository, "..", `${repository.split("/").at(-1)}.toml`)
                await writeFile(config, 'user.name = "Test"\nuser.email = "test@example.com"\n')
                const previousConfig = process.env.JJ_CONFIG
                process.env.JJ_CONFIG = config
                const client = makeApplicationClient()

                try {
                    const result = await client.recoverRepository(repository, { colocate: true })
                    expect(result.success).toBe(true)

                    const diff = Bun.spawnSync(
                        ["jj", "diff", "--summary", "-r", "@", "--ignore-working-copy"],
                        { cwd: repository, env: process.env },
                    )
                    expect(diff.stdout.toString().trim()).toBe("A file.txt")
                    const status = Bun.spawnSync(["git", "status", "--porcelain"], {
                        cwd: repository,
                    })
                    expect(status.stdout.toString()).not.toContain("kajji")
                } finally {
                    await client.dispose()
                    if (previousConfig === undefined) delete process.env.JJ_CONFIG
                    else process.env.JJ_CONFIG = previousConfig
                    await rm(config, { force: true })
                }
            })
        },
    )
})

describe("metadata moves", () => {
    test("rolls back completed moves when a later move fails", async () => {
        const files = new Set(["/repo/.jj", "/repo/.git"])
        const error = await applyMoves(
            [
                { original: "/repo/.jj", backup: "/repo/.jj.staged" },
                { original: "/repo/.git", backup: "/repo/.git.staged" },
            ],
            {
                exists: async (path) => files.has(path),
                rename: async (from, to) => {
                    if (from === "/repo/.git") throw new Error("rename blocked")
                    files.delete(from)
                    files.add(to)
                },
                remove: async () => {},
            },
        )

        expect(error).toBe("rename blocked")
        expect([...files].toSorted()).toEqual(["/repo/.git", "/repo/.jj"])
    })

    test("reports permanent-removal failures as a warning", async () => {
        const error = await removeMetadataBackups(
            [{ original: "/repo/.jj", backup: "/repo/.jj.backup" }],
            {
                exists: async () => true,
                rename: async () => {},
                remove: async () => {
                    throw new Error("operation not permitted")
                },
            },
        )

        expect(permanentRemovalResult(["/repo/.jj.backup"], error)).toEqual({
            success: true,
            backups: ["/repo/.jj.backup"],
            warning:
                "The new repository was created, but some old metadata could not be removed:\n/repo/.jj.backup: operation not permitted",
        })
    })

    test("keeps displaced new metadata when restoration fails", async () => {
        const files = new Set(["/repo/.jj", "/repo/.jj.backup"])
        const removed: string[] = []
        let restoreAttempted = false
        const error = await restoreMetadataBackups(
            [{ original: "/repo/.jj", backup: "/repo/.jj.backup" }],
            {
                exists: async (path) => files.has(path),
                rename: async (from, to) => {
                    if (from === "/repo/.jj.backup" && !restoreAttempted) {
                        restoreAttempted = true
                        throw new Error("restore blocked")
                    }
                    if (!files.delete(from)) throw new Error(`missing ${from}`)
                    files.add(to)
                },
                remove: async (path) => {
                    removed.push(path)
                    files.delete(path)
                },
            },
        )

        expect(error).toBe("restore blocked")
        expect(files.has("/repo/.jj")).toBe(true)
        expect(files.has("/repo/.jj.backup")).toBe(true)
        expect(removed).toEqual([])
    })
})
