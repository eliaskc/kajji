import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { For, createSignal, onCleanup } from "solid-js"
import { useTheme } from "../../context/theme"
import { getDebugInfo } from "../../utils/diagnostics"

function describeTerminal() {
    const program = process.env.TERM_PROGRAM
    const version = process.env.TERM_PROGRAM_VERSION
    const named = program ? `${program}${version ? ` ${version}` : ""}` : null
    return [named, process.env.TERM].filter(Boolean).join(" / ") || "unknown"
}

export function DebugInfoModal() {
    const { colors } = useTheme()
    const renderer = useRenderer()
    const [copyState, setCopyState] = createSignal<
        "idle" | "copied" | "failed"
    >("idle")
    let resetTimer: ReturnType<typeof setTimeout> | undefined
    const info = getDebugInfo()
    const entries = [
        {
            label: "Version",
            value: `${info.kajjiVersion} (Bun ${info.bunVersion})`,
        },
        { label: "Date", value: new Date().toISOString() },
        { label: "OS", value: info.platform },
        { label: "Terminal", value: describeTerminal() },
        { label: "Repository", value: info.repository },
        { label: "Memory", value: `${info.rss} RSS / ${info.heapUsed} heap` },
    ]

    useKeyboard((event) => {
        if (event.name !== "return" && event.name !== "enter") return
        event.preventDefault()
        event.stopPropagation()

        const text = entries
            .map((entry) => `${entry.label}: ${entry.value}`)
            .join("\n")
        const copied = renderer.copyToClipboardOSC52(text)
        setCopyState(copied ? "copied" : "failed")
        clearTimeout(resetTimer)
        resetTimer = setTimeout(() => setCopyState("idle"), 3000)
    })

    onCleanup(() => clearTimeout(resetTimer))

    return (
        <box flexDirection="column">
            <For each={entries}>
                {(entry) => (
                    <box flexDirection="row" gap={1}>
                        <text fg={colors().textMuted} width={11} flexShrink={0}>
                            {entry.label}
                        </text>
                        <text fg={colors().text} wrapMode="word">
                            {entry.value}
                        </text>
                    </box>
                )}
            </For>
            <box
                flexDirection="row"
                justifyContent="space-between"
                marginTop={1}
            >
                <text fg={colors().textMuted}>
                    Share this when reporting an issue.
                </text>
                <text>
                    <span
                        style={{
                            fg:
                                copyState() === "copied"
                                    ? colors().success
                                    : copyState() === "failed"
                                      ? colors().error
                                      : colors().text,
                            attributes: TextAttributes.BOLD,
                        }}
                    >
                        {copyState() === "copied"
                            ? "✓ copied"
                            : copyState() === "failed"
                              ? "failed"
                              : "copy"}
                    </span>
                    <span style={{ fg: colors().textMuted }}> enter</span>
                </text>
            </box>
        </box>
    )
}
