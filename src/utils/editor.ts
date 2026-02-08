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
	options: { cwd?: string } = {},
): Promise<OpenEditorResult> {
	const editor = getPreferredEditor()
	const proc = Bun.spawn(
		["sh", "-lc", 'exec $KAJJI_EDITOR "$@"', "kajji-editor", ...paths],
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
	const command = `${editor} ${paths.map(shellEscape).join(" ")}`.trim()

	return {
		command,
		exitCode,
		success: exitCode === 0,
	}
}
