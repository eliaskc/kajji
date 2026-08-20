import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createSignal, onCleanup } from "solid-js"
import type { CommandObserver } from "../commander/observer"
import type { CommandLogEntry } from "../context/commandlog"
import { useTheme } from "../context/theme"
import type {
    BrokenRepositoryMetadata,
    RepositoryRecoveryMode,
    RepositoryRecoveryResult,
} from "../repository-bootstrap"
import { FooterHints } from "./FooterHints"

export interface RepositoryRecoveryScreenProps {
    repoPath: string
    metadata: BrokenRepositoryMetadata
    onRecover: (
        mode: RepositoryRecoveryMode,
        colocate: boolean,
        observer: CommandObserver,
    ) => Promise<RepositoryRecoveryResult>
    onRecovered: (entries: readonly CommandLogEntry[]) => void
    onQuit: () => void
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export function RepositoryRecoveryScreen(props: RepositoryRecoveryScreenProps) {
    const { colors } = useTheme()
    const [metadataMode, setMetadataMode] = createSignal<RepositoryRecoveryMode>("backup")
    const [colocate, setColocate] = createSignal(true)
    const [step, setStep] = createSignal(0)
    const [cursor, setCursor] = createSignal(0)
    const [running, setRunning] = createSignal(false)
    const [showRecoveryLog, setShowRecoveryLog] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const [logEntries, setLogEntries] = createSignal<CommandLogEntry[]>([])
    const [spinnerTick, setSpinnerTick] = createSignal(0)
    let nextLogId = 0
    let recoveryLogTimer: ReturnType<typeof setTimeout> | undefined

    const spinnerTimer = setInterval(() => {
        if (running()) setSpinnerTick((tick) => tick + 1)
    }, 80)
    onCleanup(() => {
        clearInterval(spinnerTimer)
        if (recoveryLogTimer) clearTimeout(recoveryLogTimer)
    })

    const spinner = () => spinnerFrames[spinnerTick() % spinnerFrames.length] ?? "⠋"
    const recoveryObserver: CommandObserver = {
        start: (command, options) => {
            if (!showRecoveryLog() && !recoveryLogTimer) {
                recoveryLogTimer = setTimeout(() => {
                    recoveryLogTimer = undefined
                    if (running()) setShowRecoveryLog(true)
                }, 100)
            }
            const id = `recovery-${nextLogId++}`
            setLogEntries((entries) => [
                ...entries,
                {
                    id,
                    command,
                    kind: options?.kind ?? "jj",
                    output: "",
                    status: "running",
                    timestamp: new Date(),
                },
            ])
            return id
        },
        append: (id, chunk) => {
            setLogEntries((entries) =>
                entries.map((entry) =>
                    entry.id === id ? { ...entry, output: entry.output + chunk } : entry,
                ),
            )
        },
        finish: (id, result) => {
            setLogEntries((entries) =>
                entries.map((entry) =>
                    entry.id === id
                        ? {
                              ...entry,
                              output: entry.output || result.stdout + result.stderr,
                              status: result.success ? "success" : "failure",
                              exitCode: result.exitCode,
                              completedAt: new Date(),
                          }
                        : entry,
                ),
            )
        },
        skip: (message) => {
            const id = `recovery-${nextLogId++}`
            setLogEntries((entries) => [
                ...entries,
                {
                    id,
                    command: message,
                    kind: "info",
                    output: "",
                    status: "success",
                    timestamp: new Date(),
                    completedAt: new Date(),
                },
            ])
        },
        info: (message) => {
            const id = `recovery-${nextLogId++}`
            setLogEntries((entries) => [
                ...entries,
                {
                    id,
                    command: message,
                    kind: "info",
                    output: "",
                    status: "success",
                    timestamp: new Date(),
                    completedAt: new Date(),
                },
            ])
        },
    }

    const markers = () =>
        [props.metadata.jj ? ".jj" : null, props.metadata.git ? ".git" : null].filter(
            (marker): marker is string => marker !== null,
        )
    const markerNames = () => markers().join(" and ")
    const displayPath = () => props.repoPath.replace(new RegExp(`^${process.env.HOME}`), "~")
    const initCommand = () => (colocate() ? "jj git init --colocate" : "jj git init")
    const metadataAction = () =>
        metadataMode() === "backup"
            ? `Back up ${markerNames()}`
            : `Remove ${markerNames()} permanently`

    const runRecovery = async () => {
        setRunning(true)
        setShowRecoveryLog(false)
        setError(null)
        setLogEntries([])

        try {
            const result = await props.onRecover(metadataMode(), colocate(), recoveryObserver)
            if (result.success) {
                if (result.warning) recoveryObserver.info?.(`Warning: ${result.warning}`)
                props.onRecovered(logEntries())
            } else {
                setShowRecoveryLog(true)
                setError(result.error ?? "Repository recovery failed")
                setRunning(false)
            }
        } catch (cause) {
            setShowRecoveryLog(true)
            setError(cause instanceof Error ? cause.message : String(cause))
            setRunning(false)
        } finally {
            if (recoveryLogTimer) {
                clearTimeout(recoveryLogTimer)
                recoveryLogTimer = undefined
            }
        }
    }

    const advance = () => {
        if (step() === 0) {
            setMetadataMode(cursor() === 0 ? "backup" : "remove")
            setStep(1)
            setCursor(colocate() ? 1 : 0)
        } else if (step() === 1) {
            setColocate(cursor() === 1)
            setStep(2)
            setCursor(0)
        } else {
            void runRecovery()
        }
    }

    const goBack = () => {
        if (step() === 0) return
        const previous = step() - 1
        setStep(previous)
        setCursor(previous === 0 ? (metadataMode() === "backup" ? 0 : 1) : colocate() ? 1 : 0)
    }

    useKeyboard((evt) => {
        if (running()) {
            evt.preventDefault()
            evt.stopPropagation()
            return
        }

        if (showRecoveryLog()) {
            if (evt.name === "left" || evt.name === "escape") {
                evt.preventDefault()
                evt.stopPropagation()
                setShowRecoveryLog(false)
                setError(null)
            } else if (evt.name === "q") {
                evt.preventDefault()
                evt.stopPropagation()
                props.onQuit()
            }
            return
        }

        if (evt.name === "left" && step() > 0) {
            evt.preventDefault()
            evt.stopPropagation()
            goBack()
        } else if (evt.name === "right" && step() < 2) {
            evt.preventDefault()
            evt.stopPropagation()
            advance()
        } else if ((evt.name === "j" || evt.name === "down") && step() < 2) {
            evt.preventDefault()
            evt.stopPropagation()
            setCursor(1)
        } else if ((evt.name === "k" || evt.name === "up") && step() < 2) {
            evt.preventDefault()
            evt.stopPropagation()
            setCursor(0)
        } else if (evt.name === "return" || evt.name === "enter") {
            evt.preventDefault()
            evt.stopPropagation()
            advance()
        } else if (evt.name === "q") {
            evt.preventDefault()
            evt.stopPropagation()
            props.onQuit()
        }
    })

    const optionRow = (options: { label: string; description?: string; index: number }) => (
        <box
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={cursor() === options.index ? colors().selectionBackground : undefined}
            onMouseDown={() => setCursor(options.index)}
        >
            <text fg={colors().text}>
                {cursor() === options.index ? "●" : "○"} {options.label}
            </text>
            <box flexGrow={1} />
            <Show when={options.description}>
                <text fg={colors().textMuted}>{options.description}</text>
            </Show>
        </box>
    )

    return (
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
                width={78}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                gap={1}
            >
                <box flexDirection="column" gap={1}>
                    <box flexDirection="row">
                        <text
                            fg={
                                showRecoveryLog()
                                    ? error()
                                        ? colors().error
                                        : colors().primary
                                    : colors().error
                            }
                            attributes={TextAttributes.BOLD}
                        >
                            {showRecoveryLog()
                                ? error()
                                    ? "Repository recovery failed"
                                    : "Recovering repository"
                                : "Broken repository metadata"}
                        </text>
                        <box flexGrow={1} />
                        <Show when={!showRecoveryLog()}>
                            <text fg={colors().textMuted}>Step {step() + 1}/3</text>
                        </Show>
                    </box>
                    <Show when={showRecoveryLog()}>
                        <text fg={colors().textMuted} wrapMode="word">
                            {displayPath()}
                        </text>
                    </Show>
                    <Show when={!showRecoveryLog() && step() === 0}>
                        <box paddingBottom={1}>
                            <text fg={colors().textMuted} wrapMode="word">
                                Cannot open {markerNames()} in {displayPath()}.
                            </text>
                        </box>
                    </Show>
                </box>

                <Show
                    when={showRecoveryLog()}
                    fallback={
                        <>
                            <Show when={step() === 0}>
                                <box flexDirection="column">
                                    {optionRow({
                                        label: `Back up ${markerNames()}`,
                                        description: "Keep a copy beside the new repository",
                                        index: 0,
                                    })}
                                    {optionRow({
                                        label: `Remove ${markerNames()} permanently`,
                                        index: 1,
                                    })}
                                </box>
                            </Show>

                            <Show when={step() === 1}>
                                <box flexDirection="column">
                                    {optionRow({ label: "jj git init", index: 0 })}
                                    {optionRow({ label: "jj git init --colocate", index: 1 })}
                                </box>
                            </Show>

                            <Show when={step() === 2}>
                                <box flexDirection="column" gap={2}>
                                    <box flexDirection="column" gap={1}>
                                        <text
                                            fg={
                                                metadataMode() === "remove"
                                                    ? colors().error
                                                    : colors().text
                                            }
                                        >
                                            {metadataAction()}
                                        </text>
                                        <text fg={colors().text}>{initCommand()}</text>
                                    </box>
                                    <box
                                        paddingRight={1}
                                        backgroundColor={colors().selectionBackground}
                                    >
                                        <text fg={colors().primary}>Confirm recovery</text>
                                    </box>
                                </box>
                            </Show>

                            <FooterHints
                                hints={[
                                    {
                                        key: "enter",
                                        label: step() === 2 ? "run" : "next",
                                    },
                                    { key: "←/→", label: "steps" },
                                    { key: "q", label: "quit" },
                                ]}
                            />
                        </>
                    }
                >
                    <box flexDirection="column" gap={1}>
                        <Show
                            when={logEntries().length > 0}
                            fallback={
                                <text fg={colors().textMuted}>{spinner()} Preparing recovery…</text>
                            }
                        >
                            <For each={logEntries()}>
                                {(entry) => {
                                    const statusColor = () =>
                                        entry.status === "failure"
                                            ? colors().error
                                            : entry.status === "success"
                                              ? colors().success
                                              : colors().primary
                                    const statusIcon = () =>
                                        entry.status === "failure"
                                            ? "✕"
                                            : entry.status === "success"
                                              ? "✓"
                                              : spinner()
                                    return (
                                        <box flexDirection="column">
                                            <text fg={statusColor()}>
                                                {statusIcon()} {entry.kind === "jj" ? "$ " : ""}
                                                {entry.command}
                                            </text>
                                            <Show when={entry.output.trimEnd()}>
                                                {(output: () => string) => (
                                                    <text fg={colors().textMuted} wrapMode="word">
                                                        {output()}
                                                    </text>
                                                )}
                                            </Show>
                                        </box>
                                    )
                                }}
                            </For>
                        </Show>
                        <Show when={error()}>
                            {(message: () => string) => (
                                <text fg={colors().error} wrapMode="word">
                                    {message()}
                                </text>
                            )}
                        </Show>
                        <Show when={running()}>
                            <text fg={colors().textMuted}>Please wait…</text>
                        </Show>
                        <Show when={!running() && error()}>
                            <FooterHints
                                hints={[
                                    { key: "←", label: "back" },
                                    { key: "q", label: "quit" },
                                ]}
                            />
                        </Show>
                    </box>
                </Show>
            </box>
        </box>
    )
}
