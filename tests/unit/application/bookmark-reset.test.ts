import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import {
    type BookmarkResetMode,
    availableResetModes,
    planBookmarkReset,
    runBookmarkReset,
} from "../../../src/application/bookmark-reset"
import { makeApplicationClient } from "../../../src/application/client"
import { AppProcess, AppProcessLive } from "../../../src/process/app-process"
import { findOriginBookmark } from "../../../src/utils/bookmark-origin-diff"

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function makeRepository() {
    const root = await mkdtemp(join(tmpdir(), "kajji-reset-"))
    const repo = join(root, "repo")
    const config = join(root, "jj.toml")
    await writeFile(
        config,
        '[user]\nname="Reset test"\nemail="reset@example.com"\n[fsmonitor]\nbackend="none"\n',
    )
    const env = { ...process.env, JJ_CONFIG: config }
    const run = (cwd: string, ...args: string[]) => {
        const child = Bun.spawnSync(args, { cwd, env, stdout: "pipe", stderr: "pipe" })
        if (!child.success) throw new Error(child.stderr.toString())
        return child.stdout.toString().trim()
    }
    const processLayer = Layer.effect(
        AppProcess,
        AppProcess.use((appProcess) =>
            Effect.succeed(
                AppProcess.of({
                    run: (command) =>
                        appProcess.run({ ...command, env: { ...command.env, JJ_CONFIG: config } }),
                    stream: (command) =>
                        appProcess.stream({
                            ...command,
                            env: { ...command.env, JJ_CONFIG: config },
                        }),
                }),
            ),
        ),
    ).pipe(Layer.provide(AppProcessLive))
    const client = makeApplicationClient(processLayer)
    cleanups.push(async () => {
        await client.dispose()
        await rm(root, { recursive: true, force: true })
    })

    run(root, "git", "init", "--bare", "--quiet", "origin.git")
    run(root, "jj", "git", "init", "repo")
    const jj = (...args: string[]) => run(repo, "jj", ...args)
    jj("git", "remote", "add", "origin", join(root, "origin.git"))
    await writeFile(join(repo, "base.txt"), "base\n")
    jj("commit", "-m", "base")
    await writeFile(join(repo, "feature.txt"), "feature\n")
    jj("commit", "-m", "feature")
    jj("bookmark", "create", "feat/reset", "-r", "@-")
    jj("git", "push", "--bookmark", "feat/reset")
    // Work elsewhere, like a bookmark you are not working on.
    jj("new", "root()")

    const plan = async () => {
        const bookmarks = await client.jjBookmarks({ cwd: repo, allRemotes: true })
        const local = bookmarks.find((b) => b.isLocal && b.name === "feat/reset")
        const origin = findOriginBookmark("feat/reset", bookmarks)
        if (!local || !origin) throw new Error("missing bookmark")
        return planBookmarkReset(client, local, origin, { cwd: repo })
    }
    const reset = async (mode: BookmarkResetMode) =>
        runBookmarkReset(client, await plan(), mode, (op) => op(undefined), { cwd: repo })
    const targets = () =>
        jj(
            "bookmark",
            "list",
            "--all-remotes",
            "feat/reset",
            "-T",
            'if(remote, remote, "local") ++ "=" ++ normal_target.commit_id() ++ "\\n"',
        )
    const matchesOrigin = () => {
        const map = new Map(
            targets()
                .split("\n")
                .map((line) => line.split("=") as [string, string]),
        )
        return map.get("local") === map.get("origin")
    }
    const divergent = () => jj("log", "-r", "divergent()", "--no-graph", "-T", 'commit_id ++ "\\n"')

    return { repo, jj, plan, reset, matchesOrigin, divergent }
}

describe("bookmark reset to origin", () => {
    test("abandons a rewritten local commit with the same content", async () => {
        const repo = await makeRepository()
        repo.jj("describe", "-r", "feat/reset", "-m", "feature (rewritten)")

        const plan = await repo.plan()
        expect(plan.localOnly).toHaveLength(1)
        expect(plan.sameContent).toBe(true)
        expect(plan.affectsWorkingCopy).toBe(false)
        expect(availableResetModes(plan)).toEqual(["abandon", "keep"])

        expect((await repo.reset("abandon")).success).toBe(true)
        expect(repo.matchesOrigin()).toBe(true)
        expect(repo.divergent()).toBe("")
    })

    test("keeping local commits leaves the rewritten commit divergent", async () => {
        const repo = await makeRepository()
        repo.jj("describe", "-r", "feat/reset", "-m", "feature (rewritten)")

        expect((await repo.reset("keep")).success).toBe(true)
        expect(repo.matchesOrigin()).toBe(true)
        expect(repo.divergent()).not.toBe("")
    })

    test("abandons a whole rewritten stack", async () => {
        const repo = await makeRepository()
        repo.jj("new", "feat/reset", "-m", "second")
        repo.jj("new", "-m", "third")
        repo.jj("bookmark", "set", "feat/reset", "-r", "@")
        repo.jj("git", "push", "--bookmark", "feat/reset")
        repo.jj("new", "root()")
        // Rewriting the bottom commit rewrites every commit in the stack.
        repo.jj("describe", "-r", 'description(exact:"base\n")', "-m", "base (rewritten)")

        const plan = await repo.plan()
        expect(plan.localOnly.map((commit) => commit.description)).toEqual([
            "third",
            "second",
            "feature",
            "base (rewritten)",
        ])
        expect(availableResetModes(plan)).toEqual(["abandon", "keep"])

        expect((await repo.reset("abandon")).success).toBe(true)
        expect(repo.matchesOrigin()).toBe(true)
        expect(repo.divergent()).toBe("")
    })

    test("does not abandon commits that another bookmark uses", async () => {
        const repo = await makeRepository()
        repo.jj("bookmark", "create", "stacked", "-r", "feat/reset-")
        repo.jj("describe", "-r", "stacked", "-m", "base (rewritten)")

        const plan = await repo.plan()
        expect(plan.localOnly.map((commit) => commit.description)).toEqual(["feature"])
    })

    test("reports when the reset moves the working copy", async () => {
        const repo = await makeRepository()
        repo.jj("describe", "-r", "feat/reset", "-m", "feature (rewritten)")
        repo.jj("new", "feat/reset")

        const plan = await repo.plan()
        expect(plan.affectsWorkingCopy).toBe(true)
        expect(plan.descendants).toBe(1)
    })
})
