import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { TerminalControl } from "@kitlangton/terminal-control"
import type { Session } from "@kitlangton/terminal-control"

const projectRoot = resolve(import.meta.dir, "../..")
const openTuiPreload = Bun.resolveSync("@opentui/solid/preload", projectRoot)

function runJj(cwd: string, ...args: string[]) {
    const result = Bun.spawnSync(["jj", ...args], {
        cwd,
        env: { ...process.env, JJ_CONFIG: join(cwd, "..", "jj.toml") },
        stdout: "pipe",
        stderr: "pipe",
    })

    if (!result.success) {
        throw new Error(result.stderr.toString())
    }

    return result.stdout.toString()
}

function createRepository(root: string) {
    const repository = join(root, "repo")
    writeFileSync(
        join(root, "jj.toml"),
        '[user]\nname = "Kajji E2E"\nemail = "kajji-e2e@example.com"\n',
    )
    mkdirSync(repository)
    runJj(repository, "git", "init")

    writeFileSync(join(repository, "base.txt"), "base\n")
    runJj(repository, "commit", "-m", "fixture: base")

    writeFileSync(join(repository, "parser.txt"), "parser\n")
    runJj(repository, "commit", "-m", "fixture: parser change")

    writeFileSync(
        join(repository, "ui.txt"),
        Array.from(
            { length: 30 },
            (_, index) => `ui detail marker ${index} ${"x".repeat(45)}\n`,
        ).join(""),
    )
    writeFileSync(
        join(repository, "view.txt"),
        Array.from(
            { length: 30 },
            (_, index) => `view detail marker ${index} ${"x".repeat(45)}\n`,
        ).join(""),
    )
    runJj(repository, "describe", "-m", "fixture: UI change")

    return repository
}

async function withKajji(
    run: (session: Session, repository: string) => Promise<void>,
    prepare?: (repository: string, home: string) => void,
    readyText = "ui detail marker",
) {
    const root = mkdtempSync(join(tmpdir(), "kajji-e2e-"))
    const home = join(root, "home")
    mkdirSync(home)
    const repository = createRepository(root)
    prepare?.(repository, home)
    const terminal = await TerminalControl.make()

    try {
        const session = await terminal.launch({
            command: [
                process.execPath,
                "--preload",
                openTuiPreload,
                join(projectRoot, "src/index.tsx"),
            ],
            cwd: repository,
            host: "opentui",
            viewport: { cols: 120, rows: 36 },
            inheritEnv: true,
            env: {
                HOME: home,
                XDG_CONFIG_HOME: join(home, ".config"),
                XDG_STATE_HOME: join(home, ".local/state"),
                NODE_ENV: "development",
                JJ_CONFIG: join(root, "jj.toml"),
            },
        })

        try {
            await session.screen.waitForText("fixture: UI change", {
                timeoutMs: 30_000,
            })
            await session.screen.waitForText(readyText, {
                timeoutMs: 30_000,
            })
            await session.screen.waitForIdle({
                quietForMs: 250,
                timeoutMs: 5_000,
            })
            await run(session, repository)
        } catch (error) {
            // These repositories contain generated test data only.
            const screen = await session.screen.capture({
                settleMs: 0,
                deadlineMs: 0,
                allowIncomplete: true,
            })
            throw new Error(`${String(error)}\nVisible screen:\n${screen.text}`)
        } finally {
            await session.stop()
        }
    } finally {
        await terminal.close()
        rmSync(root, { recursive: true, force: true })
    }
}

test("scrolls variable-height revision, filtered, and operation logs", async () => {
    await withKajji(
        async (session, repository) => {
            await session.keyboard.write(Buffer.from("j".repeat(20)))
            await session.screen.waitForText("virtual-history-050", { timeoutMs: 5_000 })
            await session.keyboard.type("/")
            await waitForInput(session)
            await session.keyboard.type("all()")
            await session.screen.waitForText("virtual-history-069", { timeoutMs: 10_000 })
            await session.keyboard.press("Enter")
            await session.screen.waitUntil(
                (snapshot) =>
                    snapshot.frame.cursor === null && snapshot.text.includes("ui detail marker 0"),
                { timeoutMs: 10_000 },
            )
            await session.screen.waitForIdle({ quietForMs: 50, timeoutMs: 5_000 })
            await session.keyboard.write(Buffer.from("j".repeat(20)))
            await session.screen.waitForText("virtual-history-050", { timeoutMs: 5_000 })
            const operations = runJj(
                repository,
                "op",
                "log",
                "--no-graph",
                "-T",
                'id.short(8) ++ "\\n"',
            )
                .trim()
                .split("\n")
            await session.keyboard.type("]")
            await session.screen.waitForText(operations[0]!, { timeoutMs: 5_000 })
            await session.keyboard.write(Buffer.from("j".repeat(20)))
            await session.screen.waitForText(operations[20]!, { timeoutMs: 5_000 })
            await session.resize({ cols: 100, rows: 24 })
            await session.screen.waitForText(operations[20]!, { timeoutMs: 5_000 })
        },
        (repository) => {
            for (let i = 0; i < 70; i++)
                runJj(
                    repository,
                    "new",
                    "--before",
                    "@",
                    "--no-edit",
                    "-m",
                    `virtual-history-${String(i).padStart(3, "0")}`,
                )
        },
    )
}, 60_000)

test("keeps the top source line when toggling diff style", async () => {
    await withKajji(
        async (session) => {
            await session.resize({ cols: 200, rows: 36 })
            await session.keyboard.type("3")
            await session.screen.waitForIdle({ quietForMs: 250, timeoutMs: 5_000 })
            await session.keyboard.write(Buffer.from("j".repeat(145)))
            await session.screen.waitUntil(
                (snapshot) => !snapshot.text.includes("ui detail marker 0"),
                { timeoutMs: 5_000 },
            )
            await session.screen.waitForIdle({ quietForMs: 250, timeoutMs: 5_000 })
            const before = await session.screen.capture()
            const topMarker = before.text.match(/ui detail marker \d+/)?.[0]
            expect(topMarker).toBeDefined()
            for (let i = 0; i < 4; i++) {
                await session.keyboard.type("v")
                await session.screen.waitForIdle({ quietForMs: 250, timeoutMs: 5_000 })
                const after = await session.screen.capture()
                expect(after.text.match(/ui detail marker \d+/)?.[0]).toBe(topMarker)
            }
        },
        (repository, home) => {
            const configDir = join(home, ".config", "kajji")
            mkdirSync(configDir, { recursive: true })
            writeFileSync(
                join(configDir, "config.json"),
                JSON.stringify({ diff: { layout: "unified" } }),
            )
            writeFileSync(
                join(repository, "ui.txt"),
                Array.from({ length: 100 }, (_, i) => `ui detail marker ${i} old\n`).join(""),
            )
            runJj(repository, "commit", "-m", "fixture: old lines")
            writeFileSync(
                join(repository, "ui.txt"),
                Array.from({ length: 100 }, (_, i) => `ui detail marker ${i} new\n`).join(""),
            )
            runJj(repository, "describe", "-m", "fixture: UI change")
        },
    )
}, 45_000)

test("scrolls jj-formatter output and resizes without blank rows", async () => {
    await withKajji(
        async (session) => {
            await session.keyboard.type("3")
            await session.keyboard.write(Buffer.from("j".repeat(25)))
            await session.screen.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("ui detail marker 25") &&
                    !snapshot.text.includes("ui detail marker 0"),
                { timeoutMs: 5_000 },
            )
            await session.resize({ cols: 80, rows: 24 })
            await session.screen.waitForText("ui detail marker 25", { timeoutMs: 5_000 })
            await session.keyboard.write(Buffer.from("k".repeat(25)))
            await session.screen.waitForText("ui detail marker 0", { timeoutMs: 5_000 })
        },
        (_repository, home) => {
            const configDir = join(home, ".config", "kajji")
            mkdirSync(configDir, { recursive: true })
            writeFileSync(
                join(configDir, "config.json"),
                JSON.stringify({ diff: { engine: "jj-formatter" } }),
            )
        },
    )
}, 45_000)

test("browses virtual bookmarks and all files in a large summary", async () => {
    await withKajji(
        async (session) => {
            await session.screen.waitForText("row-000.txt", { timeoutMs: 10_000 })
            await session.keyboard.type("3")
            await session.keyboard.write(Buffer.from("j".repeat(110)))
            await session.screen.waitForText("row-119.txt", { timeoutMs: 5_000 })
            await session.keyboard.type("2")
            await session.keyboard.write(Buffer.from("j".repeat(36)))
            await session.screen.waitForText("virtual-036", { timeoutMs: 5_000 })
            await session.resize({ cols: 100, rows: 24 })
            await session.screen.waitForText("virtual-036", { timeoutMs: 5_000 })
            await session.keyboard.type("-")
            await session.screen.waitForText("remote only", { timeoutMs: 5_000 })
            await session.keyboard.write(Buffer.from("j".repeat(36)))
            await session.screen.waitForText("remote-036", { timeoutMs: 5_000 })
            await session.keyboard.type("-")
            await session.screen.waitForText("deleted only", { timeoutMs: 5_000 })
            await session.keyboard.type("-")
            await session.screen.waitUntil((snapshot) => !snapshot.text.includes("deleted only"), {
                timeoutMs: 5_000,
            })
            await session.keyboard.type("/")
            await waitForInput(session)
            await session.keyboard.type("virtual-099")
            await session.screen.waitForText("virtual-099", { timeoutMs: 5_000 })
            await session.keyboard.press("Escape")
            await session.screen.waitForIdle({ quietForMs: 100, timeoutMs: 5_000 })
            await session.keyboard.type("1")
            await session.keyboard.press("Control+X")
            await session.screen.waitForText("1 Files (", { timeoutMs: 10_000 })
            await session.screen.waitForIdle({ quietForMs: 100, timeoutMs: 5_000 })
            await session.keyboard.type("1")
            await session.keyboard.type("-")
            await session.keyboard.write(Buffer.from("j".repeat(36)))
            await session.screen.waitForText("row-034.txt", { timeoutMs: 5_000 })
            await session.keyboard.type("-")
            await session.screen.waitForIdle({ quietForMs: 100, timeoutMs: 5_000 })
            await session.keyboard.write(Buffer.from("k".repeat(150)))
            await session.keyboard.press("Enter")
            await session.screen.waitForText("▶", { timeoutMs: 5_000 })
            await session.keyboard.press("Enter")
            await session.screen.waitForText("▼", { timeoutMs: 5_000 })
            await session.keyboard.type("/")
            await waitForInput(session)
            await session.keyboard.type("row-119")
            await session.screen.waitForText("row-119.txt", { timeoutMs: 5_000 })
            await session.keyboard.press("Escape")
            await session.resize({ cols: 120, rows: 36 })
            await session.screen.waitForText("row-119.txt", { timeoutMs: 5_000 })
        },
        (repository) => {
            mkdirSync(join(repository, "z-many"))
            for (let i = 0; i < 120; i++)
                writeFileSync(
                    join(repository, "z-many", `row-${String(i).padStart(3, "0")}.txt`),
                    `file ${i}\n`,
                )
            runJj(
                repository,
                "bookmark",
                "create",
                ...Array.from({ length: 100 }, (_, i) => `virtual-${String(i).padStart(3, "0")}`),
            )
            runJj(
                repository,
                "git",
                "remote",
                "add",
                "origin",
                "file:///nonexistent-kajji-e2e-remote",
            )
            const commit = runJj(
                repository,
                "log",
                "-r",
                "@-",
                "--no-graph",
                "-T",
                "commit_id",
            ).trim()
            const refs =
                Array.from(
                    { length: 100 },
                    (_, i) =>
                        `create refs/remotes/origin/remote-${String(i).padStart(3, "0")} ${commit}`,
                ).join("\n") + "\n"
            const result = Bun.spawnSync(["git", "update-ref", "--stdin"], {
                cwd: repository,
                stdin: Buffer.from(refs),
                stdout: "pipe",
                stderr: "pipe",
            })
            if (!result.success) throw new Error(result.stderr.toString())
            runJj(repository, "git", "import")
        },
        "row-000.txt",
    )
}, 60_000)

async function waitForInput(session: Session) {
    await session.screen.waitUntil((snapshot) => snapshot.frame.cursor !== null, {
        timeoutMs: 5_000,
    })
    // Cursor visibility alone can precede deferred modal focus/input guards.
    // These are correctness tests; sustained input timing is tested separately.
    await session.screen.waitForIdle({ quietForMs: 50, timeoutMs: 5_000 })
}

test("accepts text at the first visible bookmark modal cursor", async () => {
    await withKajji(async (session) => {
        await session.keyboard.type("2")
        await session.keyboard.type("c")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Create Bookmark") && snapshot.frame.cursor !== null,
            { timeoutMs: 5_000 },
        )
        // No idle wait or focus delay: a visible cursor must accept input.
        await session.keyboard.type("immediate-input")
        await session.screen.waitForText("immediate-input", { timeoutMs: 5_000 })
        await session.keyboard.press("Escape")
    })
}, 45_000)

test("submits bookmark text and Enter in one input packet", async () => {
    await withKajji(async (session, repository) => {
        await session.keyboard.type("2")
        await session.keyboard.type("c")
        await session.screen.waitForText("Create Bookmark", { timeoutMs: 5_000 })
        // Isolate submission from initial focus readiness. After this point,
        // there is no screen wait between the text and Enter.
        await waitForInput(session)
        await session.keyboard.write(Buffer.from("immediate-submit\r"))
        await session.screen.waitUntil((snapshot) => !snapshot.text.includes("Create Bookmark"), {
            timeoutMs: 5_000,
        })
        await session.screen.waitUntil(
            () =>
                runJj(repository, "bookmark", "list", "--template", 'name ++ "\\n"')
                    .split("\n")
                    .includes("immediate-submit"),
            { timeoutMs: 10_000 },
        )
    })
}, 45_000)

test("browses revisions and keeps the detail panel in sync", async () => {
    await withKajji(async (session) => {
        const screen = await session.screen.text()
        expect(screen).toContain("1 Revisions")
        expect(screen).toContain("2 Bookmarks")
        expect(screen).toContain("3 Detail")
        expect(screen).toContain("ui.txt")

        await session.keyboard.type("j")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("fixture: parser change") &&
                snapshot.text.includes("parser.txt") &&
                !snapshot.text.includes("ui.txt"),
            { timeoutMs: 20_000 },
        )

        await session.keyboard.type("k")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("fixture: UI change") && snapshot.text.includes("ui.txt"),
            { timeoutMs: 10_000 },
        )
    })
}, 45_000)

test("keeps the latest detail after rapid revision changes and revisits", async () => {
    await withKajji(async (session) => {
        // No waits between selection inputs. Finish away from the initial detail.
        await session.keyboard.write(Buffer.from("jkjj"))
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("base.txt") &&
                !snapshot.text.includes("ui.txt") &&
                !snapshot.text.includes("parser.txt"),
            { timeoutMs: 10_000 },
        )
        await session.keyboard.write(Buffer.from("kkj"))
        await session.screen.waitUntil(
            (snapshot) => snapshot.text.includes("parser.txt") && !snapshot.text.includes("ui.txt"),
            { timeoutMs: 10_000 },
        )
        await session.keyboard.write(Buffer.from("k"))
        await session.screen.waitForText("ui detail marker", { timeoutMs: 10_000 })
    })
}, 45_000)

test("refreshes cached working-copy details after external edits", async () => {
    await withKajji(async (session, repository) => {
        writeFileSync(join(repository, "ui.txt"), "external detail update\n")
        runJj(repository, "describe", "-m", "external subject update")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("external subject update") &&
                snapshot.text.includes("external detail update") &&
                !snapshot.text.includes("ui detail marker"),
            { timeoutMs: 15_000 },
        )
        await session.keyboard.write(Buffer.from("jk"))
        await session.screen.waitForText("external detail update", { timeoutMs: 10_000 })
    })
}, 45_000)

test("snapshots external file edits on poll and on terminal focus", async () => {
    await withKajji(async (session, repository) => {
        // No jj command snapshots this edit on behalf of the application.
        writeFileSync(join(repository, "ui.txt"), "poll snapshot marker\n")
        await session.screen.waitForText("poll snapshot marker", { timeoutMs: 10_000 })
        await session.keyboard.write(Buffer.from("\u001b[O"))
        writeFileSync(join(repository, "ui.txt"), "focus snapshot marker\n")
        await session.keyboard.write(Buffer.from("\u001b[I"))
        await session.screen.waitForText("focus snapshot marker", { timeoutMs: 5_000 })
        runJj(repository, "bookmark", "create", "external-refresh-bookmark", "-r", "@")
        await session.screen.waitForText("external-refresh-bookmark", { timeoutMs: 10_000 })
        await session.keyboard.write(Buffer.from("jk"))
        await session.screen.waitForText("focus snapshot marker", { timeoutMs: 5_000 })
    })
}, 45_000)

test("enters diff mode for the selected revision and returns to normal mode", async () => {
    await withKajji(async (session) => {
        await session.keyboard.type("3")
        await session.screen.waitForText("wrap", { timeoutMs: 5_000 })
        await session.keyboard.type("jjjjjjjjjjjjjjjjjjjjjjjjjjjjjj")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("ui detail marker 15") &&
                !snapshot.text.includes("ui detail marker 0"),
            { timeoutMs: 5_000 },
        )

        await session.keyboard.press("Control+X")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 Files (") &&
                snapshot.text.includes("2 Revisions") &&
                snapshot.text.includes("3 Detail") &&
                snapshot.text.includes("ui.txt") &&
                snapshot.text.includes("ui detail marker 15") &&
                !snapshot.text.includes("ui detail marker 0") &&
                snapshot.text.includes("DIFF"),
            { timeoutMs: 10_000 },
        )

        // Test a completed layout transition, not two rapid toggles while
        // deferred scroll-anchor restoration is still active.
        await session.screen.waitForIdle({ quietForMs: 100, timeoutMs: 5_000 })
        await session.keyboard.press("Control+X")
        const screen = await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 Revisions") &&
                snapshot.text.includes("2 Bookmarks") &&
                snapshot.text.includes("4 Command log") &&
                snapshot.text.includes("ui detail marker 15") &&
                !snapshot.text.includes("ui detail marker 0") &&
                snapshot.text.includes("NORMAL"),
            { timeoutMs: 10_000 },
        )
        expect(screen.text).not.toContain("1 Files (")
    })
}, 45_000)

test("filters and executes a command from the command palette", async () => {
    await withKajji(async (session) => {
        await session.keyboard.press("Control+P")
        await session.screen.waitForText("Commands")
        await session.keyboard.type("describe")
        const filtered = await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Describe") &&
                !snapshot.text.includes("New menu") &&
                !snapshot.text.includes("Open (direct)"),
            { timeoutMs: 5_000 },
        )
        expect(filtered.text).toContain("describe")
        expect(filtered.text).toContain("Describe")
        expect(filtered.text).not.toContain("New menu")
        expect(filtered.text).not.toContain("Open (direct)")

        await session.keyboard.press("Enter")
        await session.screen.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("Commands") &&
                snapshot.text.includes("Describe") &&
                snapshot.text.includes("Body"),
            { timeoutMs: 10_000 },
        )

        await session.keyboard.press("Escape")
        const screen = await session.screen.waitUntil(
            (snapshot) => !snapshot.text.includes("Body"),
            { timeoutMs: 5_000 },
        )
        expect(screen.text).not.toContain("Search")
        expect(screen.text).toContain("fixture: UI change")
    })
}, 45_000)

test("updates a revision description from the Describe modal", async () => {
    await withKajji(async (session, repository) => {
        await session.keyboard.type("d")
        await session.screen.waitUntil(
            (snapshot) => snapshot.text.includes("Describe") && snapshot.text.includes("Body"),
            { timeoutMs: 10_000 },
        )

        await session.keyboard.press("End")
        await session.keyboard.type(" updated through modal")
        await session.screen.waitForText("fixture: UI change updated through modal", {
            timeoutMs: 5_000,
        })
        await session.keyboard.press("Enter")

        await session.screen.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("Body") &&
                snapshot.text.includes("fixture: UI change updated through modal"),
            { timeoutMs: 10_000 },
        )
        expect(runJj(repository, "log", "-r", "@", "--no-graph", "-T", "description")).toBe(
            "fixture: UI change updated through modal\n",
        )
    })
}, 45_000)

test("cancels Describe edits without changing the revision", async () => {
    await withKajji(async (session, repository) => {
        const original = runJj(repository, "log", "-r", "@", "--no-graph", "-T", "description")

        await session.keyboard.type("d")
        await session.screen.waitForText("Body", { timeoutMs: 10_000 })
        await waitForInput(session)
        await session.keyboard.press("End")
        await session.keyboard.type(" should be discarded")
        await session.screen.waitForText("fixture: UI change should be discarded", {
            timeoutMs: 5_000,
        })
        await session.keyboard.press("Escape")

        await session.screen.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("Body") && !snapshot.text.includes("should be discarded"),
            { timeoutMs: 5_000 },
        )
        expect(runJj(repository, "log", "-r", "@", "--no-graph", "-T", "description")).toBe(
            original,
        )
    })
}, 45_000)

test("creates and deletes a bookmark", async () => {
    await withKajji(async (session, repository) => {
        await session.keyboard.type("2")
        await session.keyboard.type("c")
        await session.screen.waitForText("Create Bookmark", {
            timeoutMs: 5_000,
        })
        await waitForInput(session)
        await session.keyboard.type("e2e-bookmark")
        await session.screen.waitForText("e2e-bookmark", { timeoutMs: 5_000 })
        await session.keyboard.press("Enter")

        await session.screen.waitUntil(
            () =>
                runJj(repository, "bookmark", "list", "--template", 'name ++ "\\n"')
                    .split("\n")
                    .includes("e2e-bookmark"),
            { timeoutMs: 20_000 },
        )
        expect(
            runJj(repository, "bookmark", "list", "--template", 'name ++ "\\n"').split("\n"),
        ).toContain("e2e-bookmark")

        await session.keyboard.press("Control+R")
        await session.screen.waitForIdle({ quietForMs: 250, timeoutMs: 5_000 })
        await session.keyboard.type("2")
        await session.keyboard.type("d")
        await session.screen.waitForText("Delete bookmark e2e-bookmark?", {
            timeoutMs: 5_000,
        })
        await session.keyboard.type("y")
        await session.screen.waitUntil(
            () =>
                !runJj(repository, "bookmark", "list", "--template", 'name ++ "\\n"')
                    .split("\n")
                    .includes("e2e-bookmark"),
            { timeoutMs: 10_000 },
        )
        expect(
            runJj(repository, "bookmark", "list", "--template", 'name ++ "\\n"').split("\n"),
        ).not.toContain("e2e-bookmark")
    })
}, 45_000)

function prepareRewrittenOriginBookmark(repository: string) {
    const remote = join(repository, "..", "origin.git")
    const init = Bun.spawnSync(["git", "init", "--bare", "--quiet", remote])
    if (!init.success) throw new Error(init.stderr.toString())
    runJj(repository, "git", "remote", "add", "origin", remote)
    runJj(repository, "bookmark", "create", "feat/reset", "-r", "@-")
    runJj(repository, "git", "push", "--bookmark", "feat/reset")
    runJj(repository, "describe", "-r", "@-", "-m", "fixture: parser change (rewritten)")
}

function bookmarkTargets(repository: string) {
    return runJj(
        repository,
        "bookmark",
        "list",
        "--all-remotes",
        "feat/reset",
        "--template",
        'if(remote, remote, "local") ++ " " ++ if(normal_target, normal_target.commit_id(), "") ++ "\\n"',
    )
        .trim()
        .split("\n")
        .filter((line) => !line.startsWith("git "))
}

function bookmarkMatchesOrigin(repository: string) {
    const targets = new Map(
        bookmarkTargets(repository).map((line) => line.split(" ") as [string, string]),
    )
    return Boolean(targets.get("origin")) && targets.get("local") === targets.get("origin")
}

function hasDivergentCommits(repository: string) {
    return runJj(repository, "log", "-r", "divergent()", "--no-graph", "-T", "commit_id") !== ""
}

test("resets a bookmark to origin from the bookmarks panel", async () => {
    await withKajji(async (session, repository) => {
        expect(bookmarkMatchesOrigin(repository)).toBe(false)
        await session.keyboard.type("2")
        await session.screen.waitForText("feat/reset*", { timeoutMs: 5_000 })
        await session.keyboard.type("R")
        await session.screen.waitForText("Reset feat/reset to origin", { timeoutMs: 5_000 })
        await session.screen.waitForText("reset and abandon it", { timeoutMs: 5_000 })
        await session.keyboard.type("a")
        await session.screen.waitUntil(
            () => bookmarkMatchesOrigin(repository) && !hasDivergentCommits(repository),
            { timeoutMs: 10_000 },
        )
    }, prepareRewrittenOriginBookmark)
}, 45_000)

test("resets a bookmark to origin from the compare view", async () => {
    await withKajji(async (session, repository) => {
        await session.keyboard.type("2")
        await session.screen.waitForText("feat/reset*", { timeoutMs: 5_000 })
        await session.keyboard.type("C")
        await session.screen.waitForText("reset to origin", { timeoutMs: 5_000 })
        await session.keyboard.type("R")
        await session.screen.waitForText("Reset feat/reset to origin", { timeoutMs: 5_000 })
        await session.screen.waitForText("reset and abandon it", { timeoutMs: 5_000 })
        await session.keyboard.type("a")
        await session.screen.waitUntil(
            () => bookmarkMatchesOrigin(repository) && !hasDivergentCommits(repository),
            { timeoutMs: 10_000 },
        )
    }, prepareRewrittenOriginBookmark)
}, 45_000)

test("restores a deleted bookmark from the deleted-only view", async () => {
    await withKajji(
        async (session, repository) => {
            await session.keyboard.type("2")
            await session.keyboard.type("-")
            await session.screen.waitForText("remote only", { timeoutMs: 5_000 })
            await session.keyboard.type("-")
            await session.screen.waitForText("deleted only", { timeoutMs: 5_000 })
            await session.screen.waitForText("feat/reset", { timeoutMs: 5_000 })
            await session.screen.waitForIdle({ quietForMs: 100, timeoutMs: 5_000 })
            const statusBar = (await session.screen.capture({ settleMs: 50 })).text
                .trimEnd()
                .split("\n")
                .at(-1)
            expect(statusBar).toContain("c create")
            for (const hidden of [
                "n new",
                "e edit",
                "d delete",
                "r rename",
                "open PR",
                "compare",
            ]) {
                expect(statusBar).not.toContain(hidden)
            }
            await session.keyboard.type("C")
            await session.screen.waitForText("needs a bookmark that is not deleted", {
                timeoutMs: 5_000,
            })
            await session.keyboard.type("R")
            await session.screen.waitForText("Reset feat/reset to origin?", {
                timeoutMs: 5_000,
            })
            await session.keyboard.type("y")
            await session.screen.waitUntil(() => bookmarkMatchesOrigin(repository), {
                timeoutMs: 10_000,
            })
            await session.screen.waitForText("No deleted bookmarks", { timeoutMs: 5_000 })
        },
        (repository) => {
            prepareRewrittenOriginBookmark(repository)
            runJj(repository, "bookmark", "delete", "feat/reset")
        },
    )
}, 45_000)

test("navigates between files in diff mode", async () => {
    await withKajji(async (session) => {
        const waitForNavigation = async (label: string, predicate: (text: string) => boolean) => {
            try {
                await session.screen.waitUntil((snapshot) => predicate(snapshot.text), {
                    timeoutMs: 10_000,
                })
            } catch {
                throw new Error(`${label} timed out\n${await session.screen.text()}`)
            }
        }

        const executePaletteCommand = async (query: string, title: string) => {
            await session.keyboard.press("Control+P")
            await session.screen.waitForText("Commands", { timeoutMs: 5_000 })
            await waitForInput(session)
            await session.keyboard.type(query)
            // The title also exists in the unfiltered palette. Wait for the
            // query and filtered, enabled result before submitting it.
            await session.screen.waitUntil(
                (snapshot) =>
                    snapshot.text.includes(query) &&
                    snapshot.text.includes(title) &&
                    !snapshot.text.includes("Unavailable") &&
                    !snapshot.text.includes("Open (direct)"),
                { timeoutMs: 5_000 },
            )
            await session.keyboard.press("Enter")
        }

        await session.keyboard.press("Control+X")
        await waitForNavigation(
            "entering diff mode",
            (text) =>
                text.includes("1 Files (") &&
                text.includes("DIFF") &&
                text.includes("ui.txt") &&
                text.includes("view.txt") &&
                text.includes("ui detail marker") &&
                !text.includes("view detail marker"),
        )

        await session.resize({ cols: 200, rows: 36 })
        await session.screen.waitUntil((snapshot) => snapshot.frame.cols === 200, {
            timeoutMs: 5_000,
        })
        await session.keyboard.type("3")
        await session.screen.waitForText("wrap", { timeoutMs: 5_000 })
        await executePaletteCommand("next file", "Next file")
        await waitForNavigation(
            "navigating to the next file",
            (text) =>
                !text.includes("Commands") &&
                text.includes("view detail marker") &&
                !text.includes("ui detail marker"),
        )

        await executePaletteCommand("previous file", "Previous file")
        await waitForNavigation(
            "navigating to the previous file",
            (text) => !text.includes("Commands") && text.includes("ui detail marker"),
        )

        // First hunk is in ui.txt; the next crosses into view.txt. Reuse the
        // navigation index after file movement and after row layout changes.
        for (const cols of [200, 100]) {
            await session.resize({ cols, rows: 36 })
            await session.screen.waitForIdle({ quietForMs: 100, timeoutMs: 5_000 })
            await session.keyboard.type("]")
            await session.screen.waitForIdle({ quietForMs: 100, timeoutMs: 5_000 })
            await session.keyboard.type("]")
            await waitForNavigation(
                "next hunk across a file boundary",
                (text) => text.includes("view detail marker") && !text.includes("ui detail marker"),
            )
            await session.keyboard.type("[")
            await waitForNavigation("previous hunk", (text) => text.includes("ui detail marker"))
            await executePaletteCommand("previous file", "Previous file")
            await waitForNavigation(
                "reset file position",
                (text) => !text.includes("Commands") && text.includes("ui detail marker"),
            )
        }
    })
}, 45_000)

test("undoes a description update", async () => {
    await withKajji(async (session, repository) => {
        await session.keyboard.type("d")
        await session.screen.waitForText("Body", { timeoutMs: 10_000 })
        await waitForInput(session)
        await session.keyboard.press("End")
        await session.keyboard.type(" then undo")
        await session.screen.waitForText("fixture: UI change then undo", {
            timeoutMs: 5_000,
        })
        await session.keyboard.press("Enter")
        await session.screen.waitForText("fixture: UI change then undo", {
            timeoutMs: 10_000,
        })

        await session.keyboard.type("u")
        await session.screen.waitForText("Undo last operation?", {
            timeoutMs: 10_000,
        })
        await session.keyboard.type("y")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("fixture: UI change") &&
                !snapshot.text.includes("then undo"),
            { timeoutMs: 10_000 },
        )
        await session.screen.waitForIdle({
            quietForMs: 250,
            timeoutMs: 5_000,
        })
        expect(runJj(repository, "log", "-r", "@", "--no-graph", "-T", "description")).toBe(
            "fixture: UI change\n",
        )
    })
}, 45_000)

test("reports a failed operation in the command log", async () => {
    await withKajji(async (session, repository) => {
        await session.keyboard.type("2")
        await session.keyboard.type("c")
        await session.screen.waitForText("Create Bookmark", {
            timeoutMs: 5_000,
        })
        await waitForInput(session)
        await session.keyboard.type("invalid:name")
        await session.screen.waitForText("invalid:name", { timeoutMs: 5_000 })
        await session.keyboard.press("Enter")

        await session.resize({ cols: 200, rows: 36 })
        await session.screen.waitUntil((snapshot) => snapshot.frame.cols === 200, {
            timeoutMs: 5_000,
        })
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("invalid:name") && snapshot.text.includes("expected <EOI>"),
            { timeoutMs: 20_000 },
        )
        expect(
            runJj(repository, "bookmark", "list", "--template", 'name ++ "\\n"')
                .split("\n")
                .filter((name) => name === "invalid:name"),
        ).toHaveLength(0)
    })
}, 45_000)

test("preserves selection across terminal resizes", async () => {
    await withKajji(async (session) => {
        await session.keyboard.type("j")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("fixture: parser change") &&
                snapshot.text.includes("parser.txt") &&
                !snapshot.text.includes("ui.txt"),
            { timeoutMs: 10_000 },
        )

        await session.resize({ cols: 80, rows: 24 })
        const compact = await session.screen.waitUntil(
            (snapshot) =>
                snapshot.frame.cols === 80 &&
                snapshot.frame.rows === 24 &&
                snapshot.text.includes("fixture: parser change") &&
                snapshot.text.includes("parser.txt"),
            { timeoutMs: 5_000 },
        )
        expect(compact.text).not.toContain("ui.txt")

        await session.resize({ cols: 120, rows: 36 })
        const restored = await session.screen.waitUntil(
            (snapshot) =>
                snapshot.frame.cols === 120 &&
                snapshot.frame.rows === 36 &&
                snapshot.text.includes("1 Revisions") &&
                snapshot.text.includes("2 Bookmarks") &&
                snapshot.text.includes("3 Detail") &&
                snapshot.text.includes("4 Command log") &&
                snapshot.text.includes("fixture: parser change") &&
                snapshot.text.includes("parser.txt"),
            { timeoutMs: 5_000 },
        )
        expect(restored.text).not.toContain("ui.txt")
    })
}, 45_000)

test("selects multiple revisions and shows a combined diff", async () => {
    await withKajji(async (session) => {
        // Mark the working copy and its parent with space.
        await session.keyboard.type(" j ")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("2 revisions") &&
                snapshot.text.includes("Committed:") &&
                snapshot.text.includes("ui.txt") &&
                snapshot.text.includes("parser.txt"),
            { timeoutMs: 10_000 },
        )

        // Escape clears the marks and restores the single-revision detail.
        await session.keyboard.press("Escape")
        await session.screen.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("2 revisions") && snapshot.text.includes("Author:"),
            { timeoutMs: 10_000 },
        )

        // Visual mode: v anchors, j extends, v commits the range.
        await session.keyboard.type("v")
        await session.screen.waitForText("VISUAL", { timeoutMs: 5_000 })
        await session.keyboard.type("j")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("2 revisions") &&
                snapshot.text.includes("parser.txt") &&
                snapshot.text.includes("base.txt"),
            { timeoutMs: 10_000 },
        )
        await session.keyboard.type("v")
        await session.screen.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("VISUAL") && snapshot.text.includes("2 revisions"),
            { timeoutMs: 5_000 },
        )

        // The files view shows the combined file list for the selection.
        await session.keyboard.press("Enter")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Files (2 revisions)") &&
                snapshot.text.includes("parser.txt") &&
                snapshot.text.includes("base.txt"),
            { timeoutMs: 10_000 },
        )

        // First escape leaves the files view, second clears the selection.
        await session.keyboard.press("Escape")
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 Revisions") && snapshot.text.includes("2 Bookmarks"),
            { timeoutMs: 5_000 },
        )
        await session.keyboard.press("Escape")
        await session.screen.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("2 revisions") && snapshot.text.includes("Author:"),
            { timeoutMs: 10_000 },
        )
    })
}, 45_000)
