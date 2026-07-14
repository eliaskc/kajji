import { getRepoPath } from "../repo"

export interface OpenEditorResult {
    command: string
    exitCode: number
    success: boolean
}

const TERMINAL_EDITORS = new Set([
    "vi",
    "vim",
    "nvim",
    "nano",
    "pico",
    "micro",
    "kak",
    "kakoune",
    "helix",
    "hx",
    "joe",
    "ne",
])

const PLUS_LINE_EDITORS = new Set([
    "vi",
    "vim",
    "nvim",
    "nano",
    "pico",
    "emacs",
    "emacsclient",
])
const GOTO_LINE_EDITORS = new Set(["code", "code-insiders", "codium", "cursor"])
const COLON_LINE_EDITORS = new Set(["hx", "helix", "micro", "subl", "zed"])

function editorBasename(editor: string): string {
    const command = editor.trim().split(/\s+/).filter(Boolean)[0] ?? ""
    return command.split("/").pop()?.toLowerCase() ?? command.toLowerCase()
}

export function getEditorArguments(
    paths: string[],
    editor = getPreferredEditor(),
    line?: number,
): string[] {
    if (paths.length !== 1 || line === undefined || line < 1) return paths

    const basename = editorBasename(editor)
    const path = paths[0]
    if (!path) return paths
    if (GOTO_LINE_EDITORS.has(basename)) {
        return ["--goto", `${path}:${line}`]
    }
    if (COLON_LINE_EDITORS.has(basename)) return [`${path}:${line}`]
    if (PLUS_LINE_EDITORS.has(basename)) return [`+${line}`, path]
    if (basename === "idea" || basename === "webstorm") {
        return ["--line", String(line), path]
    }
    return paths
}

function shellEscape(arg: string): string {
    if (!arg) return "''"
    if (/^[A-Za-z0-9_./:@-]+$/.test(arg)) return arg
    return `'${arg.replace(/'/g, "'\\''")}'`
}

export function getPreferredEditor(): string {
    return process.env.VISUAL || process.env.EDITOR || "vi"
}

export function shouldSuspendForEditor(editor = getPreferredEditor()): boolean {
    const override = process.env.KAJJI_EDITOR_SUSPEND?.toLowerCase()
    if (override === "1" || override === "true" || override === "yes") {
        return true
    }
    if (override === "0" || override === "false" || override === "no") {
        return false
    }

    const parts = editor.trim().split(/\s+/).filter(Boolean)
    const command = parts[0]?.toLowerCase() ?? ""
    const basename = command.split("/").pop() || command

    if (basename === "emacs" && parts.includes("-nw")) return true
    if (
        basename === "emacsclient" &&
        (parts.includes("-t") || parts.includes("--tty"))
    ) {
        return true
    }

    return TERMINAL_EDITORS.has(basename)
}

export async function openInEditor(
    paths: string[],
    options: { cwd?: string; line?: number } = {},
): Promise<OpenEditorResult> {
    const editor = getPreferredEditor()
    const args = getEditorArguments(paths, editor, options.line)
    const proc = Bun.spawn(
        ["sh", "-lc", 'exec $KAJJI_EDITOR "$@"', "kajji-editor", ...args],
        {
            cwd: options.cwd ?? getRepoPath(),
            env: {
                ...process.env,
                KAJJI_EDITOR: editor,
            },
            stdio: ["inherit", "inherit", "inherit"],
        },
    )

    const exitCode = await proc.exited
    const command = `${editor} ${args.map(shellEscape).join(" ")}`.trim()

    return {
        command,
        exitCode,
        success: exitCode === 0,
    }
}
