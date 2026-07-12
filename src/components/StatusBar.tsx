import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useCommand } from "../context/command"
import { useLayout } from "../context/layout"
import { useStatus } from "../context/status"
import { useTheme } from "../context/theme"
import { useUpdate } from "../context/update"
import { blendColors } from "../utils/color"
import { getCurrentVersion } from "../utils/update"

export function StatusBar() {
    const command = useCommand()
    const layout = useLayout()
    const status = useStatus()
    const update = useUpdate()
    const { colors, style } = useTheme()
    const [animationTick, setAnimationTick] = createSignal(0)
    const timer = setInterval(() => {
        const status = update.state().status
        if (
            status === "checking" ||
            status === "updating" ||
            status === "success"
        ) {
            setAnimationTick((index) => index + 1)
        }
    }, 200)
    onCleanup(() => clearInterval(timer))

    const relevantCommands = createMemo(() => {
        const all = command.activeForSurface("statusBar")

        const contextCmds = all.filter(
            (cmd) => cmd.keybind && cmd.context !== "global",
        )
        const globalCmds = all.filter(
            (cmd) => cmd.keybind && cmd.context === "global",
        )

        const seen = new Set<string>()
        return [...contextCmds, ...globalCmds].filter((cmd) => {
            if (seen.has(cmd.id)) return false
            seen.add(cmd.id)
            return true
        })
    })

    const contextCommands = createMemo(() =>
        relevantCommands().filter((cmd) => cmd.context !== "global"),
    )
    const globalCommands = createMemo(() =>
        relevantCommands().filter((cmd) => cmd.context === "global"),
    )

    const separator = () => style().statusBar.separator
    const isFocusMode = () => layout.focusMode() === "focus"

    const commandGap = separator() ? ` ${separator()} ` : "   "

    const versionText = () => {
        const state = update.state()
        if (state.status === "success" && state.version)
            return `v${state.version}*`
        return `v${getCurrentVersion()}`
    }

    const versionColor = () => {
        const state = update.state()
        if (state.status === "failure") return colors().error
        if (state.status === "success") {
            animationTick()
            const age = state.completedAt
                ? Date.now() - state.completedAt.getTime()
                : 0
            if (age < 1500) return colors().statusBarKey
            const fadeProgress = Math.min(1, (age - 1500) / 300)
            const easedProgress = 1 - (1 - fadeProgress) ** 3
            return blendColors(
                colors().statusBarKey,
                colors().textMuted,
                1 - easedProgress,
            )
        }
        return colors().textMuted
    }

    const waveColor = (index: number, length: number) => {
        animationTick()
        const phase = animationTick() % Math.max(length, 1)
        const distance = Math.abs(index - phase)
        const wrappedDistance = Math.min(distance, length - distance)
        const opacity = Math.max(0.15, 1 - wrappedDistance * 0.28)
        return blendColors(colors().statusBarKey, colors().textMuted, opacity)
    }

    const shouldPulseVersion = () => {
        const status = update.state().status
        return status === "checking" || status === "updating"
    }

    const statusMessageColor = () => {
        const message = status.message()
        if (!message) return colors().textMuted
        if (message.kind === "success") return colors().statusBarKey
        if (message.kind === "error") return colors().error
        return colors().textMuted
    }

    return (
        <box height={1} flexShrink={0} flexDirection="row">
            <>
                <Show
                    when={status.message()}
                    fallback={
                        <>
                            <box
                                flexShrink={0}
                                backgroundColor={
                                    isFocusMode()
                                        ? colors().titleBarFocused
                                        : undefined
                                }
                            >
                                <text
                                    wrapMode="none"
                                    fg={
                                        isFocusMode()
                                            ? colors().titleTextFocused
                                            : colors().textMuted
                                    }
                                >
                                    {isFocusMode() ? " FOCUS " : " NORMAL"}
                                </text>
                            </box>
                            <box width={1} />
                            <box flexGrow={1} overflow="hidden">
                                <text wrapMode="none">
                                    <For each={contextCommands()}>
                                        {(cmd, index) => (
                                            <>
                                                <span
                                                    style={{
                                                        fg: colors()
                                                            .statusBarKey,
                                                    }}
                                                >
                                                    {command.keyLabel(cmd.id)}
                                                </span>{" "}
                                                <span
                                                    style={{
                                                        fg: colors().textMuted,
                                                    }}
                                                >
                                                    {cmd.title}
                                                </span>
                                                <Show
                                                    when={
                                                        index() <
                                                        contextCommands()
                                                            .length -
                                                            1
                                                    }
                                                >
                                                    <span
                                                        style={{
                                                            fg: separator()
                                                                ? colors()
                                                                      .textMuted
                                                                : undefined,
                                                        }}
                                                    >
                                                        {commandGap}
                                                    </span>
                                                </Show>
                                            </>
                                        )}
                                    </For>
                                </text>
                            </box>
                            <Show when={globalCommands().length > 0}>
                                <box flexShrink={0}>
                                    <text wrapMode="none">
                                        <For each={globalCommands()}>
                                            {(cmd, index) => (
                                                <>
                                                    <Show when={index() > 0}>
                                                        <span
                                                            style={{
                                                                fg: separator()
                                                                    ? colors()
                                                                          .textMuted
                                                                    : undefined,
                                                            }}
                                                        >
                                                            {commandGap}
                                                        </span>
                                                    </Show>
                                                    <span
                                                        style={{
                                                            fg: colors()
                                                                .statusBarKey,
                                                        }}
                                                    >
                                                        {command.keyLabel(
                                                            cmd.id,
                                                        )}
                                                    </span>{" "}
                                                    <span
                                                        style={{
                                                            fg: colors()
                                                                .textMuted,
                                                        }}
                                                    >
                                                        {cmd.title}
                                                    </span>
                                                </>
                                            )}
                                        </For>
                                    </text>
                                </box>
                            </Show>
                        </>
                    }
                >
                    <box flexGrow={1} overflow="hidden">
                        <text fg={statusMessageColor()} wrapMode="none">
                            {status.message()?.text}
                        </text>
                    </box>
                </Show>
                <box flexShrink={0} marginLeft={2}>
                    <text fg={versionColor()} wrapMode="none">
                        <Show
                            when={shouldPulseVersion()}
                            fallback={versionText()}
                        >
                            <For each={[...versionText()]}>
                                {(char, index) => (
                                    <span
                                        style={{
                                            fg: waveColor(
                                                index(),
                                                versionText().length,
                                            ),
                                        }}
                                    >
                                        {char}
                                    </span>
                                )}
                            </For>
                        </Show>
                    </text>
                </box>
            </>
        </box>
    )
}
