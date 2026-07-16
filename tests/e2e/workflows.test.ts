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
    mkdirSync(repository)
    runJj(repository, "git", "init")
    runJj(repository, "config", "set", "--repo", "user.name", "Kajji E2E")
    runJj(
        repository,
        "config",
        "set",
        "--repo",
        "user.email",
        "kajji-e2e@example.com",
    )

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
) {
    const root = mkdtempSync(join(tmpdir(), "kajji-e2e-"))
    const home = join(root, "home")
    mkdirSync(home)
    const repository = createRepository(root)
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
            },
        })

        try {
            await session.screen.waitForText("fixture: UI change", {
                timeoutMs: 30_000,
            })
            await session.screen.waitForText("ui detail marker", {
                timeoutMs: 30_000,
            })
            await session.screen.waitForIdle({
                quietForMs: 250,
                timeoutMs: 5_000,
            })
            await run(session, repository)
        } finally {
            await session.stop()
        }
    } finally {
        await terminal.close()
        rmSync(root, { recursive: true, force: true })
    }
}

async function waitForInput(session: Session) {
    await session.screen.waitUntil(
        (snapshot) => snapshot.frame.cursor !== null,
        {
            timeoutMs: 5_000,
        },
    )
}

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
                snapshot.text.includes("fixture: UI change") &&
                snapshot.text.includes("ui.txt"),
            { timeoutMs: 10_000 },
        )
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
            (snapshot) =>
                snapshot.text.includes("Describe") &&
                snapshot.text.includes("Body"),
            { timeoutMs: 10_000 },
        )

        await session.keyboard.press("End")
        await session.keyboard.type(" updated through modal")
        await session.screen.waitForText(
            "fixture: UI change updated through modal",
            {
                timeoutMs: 5_000,
            },
        )
        await session.keyboard.press("Enter")

        await session.screen.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("Body") &&
                snapshot.text.includes(
                    "fixture: UI change updated through modal",
                ),
            { timeoutMs: 10_000 },
        )
        expect(
            runJj(
                repository,
                "log",
                "-r",
                "@",
                "--no-graph",
                "-T",
                "description",
            ),
        ).toBe("fixture: UI change updated through modal\n")
    })
}, 45_000)

test("cancels Describe edits without changing the revision", async () => {
    await withKajji(async (session, repository) => {
        const original = runJj(
            repository,
            "log",
            "-r",
            "@",
            "--no-graph",
            "-T",
            "description",
        )

        await session.keyboard.type("d")
        await session.screen.waitForText("Body", { timeoutMs: 10_000 })
        await waitForInput(session)
        await session.keyboard.press("End")
        await session.keyboard.type(" should be discarded")
        await session.screen.waitForText(
            "fixture: UI change should be discarded",
            { timeoutMs: 5_000 },
        )
        await session.keyboard.press("Escape")

        await session.screen.waitUntil(
            (snapshot) =>
                !snapshot.text.includes("Body") &&
                !snapshot.text.includes("should be discarded"),
            { timeoutMs: 5_000 },
        )
        expect(
            runJj(
                repository,
                "log",
                "-r",
                "@",
                "--no-graph",
                "-T",
                "description",
            ),
        ).toBe(original)
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
        await session.keyboard.press("Enter")

        await session.screen.waitUntil(
            () =>
                runJj(
                    repository,
                    "bookmark",
                    "list",
                    "--template",
                    'name ++ "\\n"',
                )
                    .split("\n")
                    .includes("e2e-bookmark"),
            { timeoutMs: 20_000 },
        )
        expect(
            runJj(
                repository,
                "bookmark",
                "list",
                "--template",
                'name ++ "\\n"',
            ).split("\n"),
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
                !runJj(
                    repository,
                    "bookmark",
                    "list",
                    "--template",
                    'name ++ "\\n"',
                )
                    .split("\n")
                    .includes("e2e-bookmark"),
            { timeoutMs: 10_000 },
        )
        expect(
            runJj(
                repository,
                "bookmark",
                "list",
                "--template",
                'name ++ "\\n"',
            ).split("\n"),
        ).not.toContain("e2e-bookmark")
    })
}, 45_000)

test("navigates between files in diff mode", async () => {
    await withKajji(async (session) => {
        const waitForNavigation = async (
            label: string,
            predicate: (text: string) => boolean,
        ) => {
            try {
                await session.screen.waitUntil(
                    (snapshot) => predicate(snapshot.text),
                    { timeoutMs: 10_000 },
                )
            } catch {
                throw new Error(
                    `${label} timed out\n${await session.screen.text()}`,
                )
            }
        }

        const executePaletteCommand = async (query: string, title: string) => {
            await session.keyboard.press("Control+P")
            await session.screen.waitForText("Commands", { timeoutMs: 5_000 })
            await waitForInput(session)
            await session.keyboard.type(query)
            await session.screen.waitForText(title, { timeoutMs: 5_000 })
            await session.keyboard.press("Enter")
        }

        await session.keyboard.press("Control+X")
        await waitForNavigation(
            "entering diff mode",
            (text) =>
                text.includes("ui.txt") &&
                text.includes("view.txt") &&
                text.includes("ui detail marker") &&
                !text.includes("view detail marker"),
        )

        await session.resize({ cols: 200, rows: 36 })
        await session.screen.waitUntil(
            (snapshot) => snapshot.frame.cols === 200,
            { timeoutMs: 5_000 },
        )
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
            (text) =>
                !text.includes("Commands") && text.includes("ui detail marker"),
        )
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
        expect(
            runJj(
                repository,
                "log",
                "-r",
                "@",
                "--no-graph",
                "-T",
                "description",
            ),
        ).toBe("fixture: UI change\n")
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
        await session.screen.waitUntil(
            (snapshot) => snapshot.frame.cols === 200,
            { timeoutMs: 5_000 },
        )
        await session.screen.waitUntil(
            (snapshot) =>
                snapshot.text.includes("invalid:name") &&
                snapshot.text.includes("expected <EOI>"),
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
