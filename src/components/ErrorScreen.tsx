import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { type ParsedJjError, parseJjError } from "../utils/error-parser"
import { FooterHints } from "./FooterHints"
import { WaveBackground } from "./WaveBackground"

export interface ErrorScreenProps {
    error: string
    onFix?: () => Promise<void>
    onQuit: () => void
}

/**
 * Full-screen error. Known errors offer a fix command; unknown errors show
 * the full jj output so the user can act on it outside kajji.
 */
export function ErrorScreen(props: ErrorScreenProps) {
    const { colors } = useTheme()
    const [isFixing, setIsFixing] = createSignal(false)
    const [attempts, setAttempts] = createSignal(1)

    const parsedError = (): ParsedJjError => parseJjError(props.error)

    const canFix = () => parsedError().fixCommand !== null && props.onFix !== undefined

    const handleFix = async () => {
        if (!props.onFix) return
        setIsFixing(true)
        try {
            await props.onFix()
            setAttempts((n) => n + 1)
        } finally {
            setIsFixing(false)
        }
    }

    useKeyboard((evt) => {
        if (isFixing()) return

        const isEnter = evt.name === "return" || evt.name === "enter"
        if (evt.name === "q" || (isEnter && !canFix())) {
            evt.preventDefault()
            evt.stopPropagation()
            props.onQuit()
        } else if ((evt.name === "f" || isEnter) && canFix()) {
            evt.preventDefault()
            evt.stopPropagation()
            handleFix()
        }
    })

    return (
        <box flexGrow={1} width="100%" height="100%">
            <WaveBackground peakColor={colors().error} peakOpacity={0.7} />
            <box
                position="absolute"
                left={0}
                top={0}
                width="100%"
                height="100%"
                zIndex={1}
                flexGrow={1}
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
            >
                <box
                    flexDirection="column"
                    backgroundColor={colors().background}
                    width={70}
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={1}
                    paddingBottom={1}
                    gap={1}
                >
                    <text fg={colors().error} attributes={TextAttributes.BOLD}>
                        Error
                    </text>
                    <box flexDirection="column">
                        <text fg={colors().error} wrapMode="word">
                            {attempts() > 1
                                ? `${parsedError().title} [${attempts()}]`
                                : parsedError().title}
                        </text>
                    </box>

                    <Show when={!canFix() && parsedError().details.length > 0}>
                        <box flexDirection="column">
                            <For each={parsedError().details}>
                                {(line) => (
                                    <text fg={colors().textMuted} wrapMode="char">
                                        {line}
                                    </text>
                                )}
                            </For>
                        </box>
                    </Show>

                    <Show when={parsedError().hints.length > 0}>
                        <box flexDirection="column">
                            <For each={parsedError().hints}>
                                {(hint) => (
                                    <text fg={colors().warning} wrapMode="word">
                                        {hint}
                                    </text>
                                )}
                            </For>
                        </box>
                    </Show>

                    <Show when={canFix() && parsedError().urls.length > 0}>
                        <box flexDirection="column">
                            <text fg={colors().textMuted}>More info:</text>
                            <For each={parsedError().urls}>
                                {(url) => (
                                    <text fg={colors().brand} wrapMode="none">
                                        {url}
                                    </text>
                                )}
                            </For>
                        </box>
                    </Show>

                    <Show when={canFix()}>
                        <box
                            flexDirection="row"
                            justifyContent="space-between"
                            paddingLeft={1}
                            paddingRight={1}
                            backgroundColor={isFixing() ? undefined : colors().selectionBackground}
                        >
                            <text fg={isFixing() ? colors().textMuted : colors().text}>
                                {isFixing() ? "Running..." : parsedError().fixCommand}
                            </text>
                            <text fg={colors().brand}>f</text>
                        </box>
                    </Show>

                    <FooterHints
                        hints={
                            canFix()
                                ? [
                                      { key: "enter", label: "run" },
                                      { key: "q", label: "quit" },
                                  ]
                                : [{ key: "enter/q", label: "quit" }]
                        }
                    />
                </box>
            </box>
        </box>
    )
}
