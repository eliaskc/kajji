import { relative } from "node:path"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { CommandObserver } from "../commander/observer"
import type { CommandLogEntry } from "../context/commandlog"
import { useTheme } from "../context/theme"
import {
    type BrokenRepositoryMetadata,
    RECOVERY_BACKUP_DIRECTORY,
    type RepositoryRecoveryMode,
    type RepositoryRecoveryResult,
} from "../repository-bootstrap"
import { abbreviateHomePath } from "../utils/home-path"
import { FooterHints } from "./FooterHints"

export interface RepositoryRecoveryScreenProps {
    repoPath: string
    metadata: BrokenRepositoryMetadata
    /** A healthy `.git` exists, so the new repository must colocate with it. */
    hasGitRepo: boolean
    onRecover: (
        mode: RepositoryRecoveryMode,
        colocate: boolean,
        observer: CommandObserver,
    ) => Promise<RepositoryRecoveryResult>
    onRecovered: (entries: readonly CommandLogEntry[]) => void
    onQuit: () => void
}

interface Choice {
    readonly question?: string
    readonly options: readonly ChoiceOption[]
    readonly selected: () => number
    readonly select: (index: number) => void
}

interface ChoiceOption {
    readonly label: string
    readonly description?: string
    /** Render the label as a shell command, like the command log does. */
    readonly command?: boolean
    readonly danger?: boolean
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
const BACKUP_LOCATION = `.jj/${RECOVERY_BACKUP_DIRECTORY}`
const DEFAULT_INIT = "jj git init"
const COLOCATED_INIT = "jj git init --colocate"

export function RepositoryRecoveryScreen(props: RepositoryRecoveryScreenProps) {
    const { colors } = useTheme()
    const [mode, setMode] = createSignal<RepositoryRecoveryMode>("backup")
    const [colocate, setColocate] = createSignal(true)
    // Index of the current choice in `choices()`. Earlier choices are locked.
    const [focus, setFocus] = createSignal(0)
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

    const markerNames = () =>
        [props.metadata.jj ? ".jj" : null, props.metadata.git ? ".git" : null]
            .filter((marker): marker is string => marker !== null)
            .join(" and ")
    const displayPath = () => abbreviateHomePath(props.repoPath)
    // Only `.jj` is broken and `.git` works: jj must import the existing Git repository.
    const keepsGit = () => props.hasGitRepo && !props.metadata.git
    const effectiveColocate = () => keepsGit() || colocate()
    const consequence = () => {
        if (keepsGit()) {
            return "Kajji makes a new jj repository from the existing .git. Your files and Git history stay as they are."
        }
        const lost = props.metadata.git ? "commit history" : "jj history"
        return `Kajji makes a new, empty repository here. Your files stay as they are, but the old ${lost} is not recovered.`
    }

    const metadataChoice: Choice = {
        question: "What should happen to the old metadata?",
        options: [
            { label: "Back up", description: `Kept in ${BACKUP_LOCATION}` },
            { label: "Delete", danger: true },
        ],
        selected: () => (mode() === "backup" ? 0 : 1),
        select: (index) => setMode(index === 0 ? "backup" : "remove"),
    }
    // The command is the last choice: picking it runs the recovery, so it needs no question.
    const commandChoice = createMemo<Choice>(() =>
        keepsGit()
            ? {
                  options: [{ label: COLOCATED_INIT, command: true }],
                  selected: () => 0,
                  select: () => {},
              }
            : {
                  options: [
                      { label: DEFAULT_INIT, command: true },
                      { label: COLOCATED_INIT, command: true },
                  ],
                  selected: () => (colocate() ? 1 : 0),
                  select: (index) => setColocate(index === 1),
              },
    )
    const choices = () => [metadataChoice, commandChoice()]
    const lastIndex = () => choices().length - 1
    const currentChoice = () => choices()[focus()]!
    const onLastChoice = () => focus() === lastIndex()

    const addMessage = (message: string, status: CommandLogEntry["status"]) => {
        const now = new Date()
        setLogEntries((entries) => [
            ...entries,
            {
                id: `recovery-${nextLogId++}`,
                message,
                kind: "info",
                output: "",
                status,
                timestamp: now,
                completedAt: now,
            },
        ])
    }
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
        skip: (message) => addMessage(message, "skipped"),
        info: (message) => addMessage(message, "info"),
    }

    const runRecovery = async () => {
        setRunning(true)
        setShowRecoveryLog(false)
        setError(null)
        setLogEntries([])

        try {
            const result = await props.onRecover(mode(), effectiveColocate(), recoveryObserver)
            if (result.success) {
                if (result.warning) addMessage(`Warning: ${result.warning}`, "info")
                addMessage(
                    result.backupDirectory
                        ? `Recovered repository. Old metadata is in ${relative(props.repoPath, result.backupDirectory)}`
                        : "Recovered repository",
                    "info",
                )
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

    // The failing step already prints its error. Show only the lines it does not contain.
    const unreportedError = () => {
        const message = error()
        if (!message) return null
        const lines = message.split("\n").filter(
            (line) =>
                !logEntries().some((entry) => {
                    const output = entry.output.trim()
                    return output.length > 0 && line.includes(output)
                }),
        )
        return lines.length > 0 ? lines.join("\n") : null
    }

    const changeChoice = (delta: number) => {
        const choice = currentChoice()
        const next = choice.selected() + delta
        if (next >= 0 && next < choice.options.length) choice.select(next)
    }
    const advance = () => {
        if (onLastChoice()) void runRecovery()
        else setFocus((index) => index + 1)
    }
    const goBack = () => setFocus((index) => Math.max(0, index - 1))

    useKeyboard((evt) => {
        const handled = () => {
            evt.preventDefault()
            evt.stopPropagation()
        }
        if (running()) return handled()

        if (showRecoveryLog()) {
            if (evt.name === "left" || evt.name === "escape") {
                handled()
                setShowRecoveryLog(false)
                setError(null)
            } else if (evt.name === "q") {
                handled()
                props.onQuit()
            }
            return
        }

        const name = evt.name
        if (name === "q") {
            handled()
            props.onQuit()
        } else if (name === "down" || name === "j") {
            handled()
            changeChoice(1)
        } else if (name === "up" || name === "k") {
            handled()
            changeChoice(-1)
        } else if (name === "return" || name === "enter") {
            handled()
            advance()
        } else if (name === "right" && !onLastChoice()) {
            handled()
            advance()
        } else if (name === "escape" || (name === "left" && focus() > 0)) {
            handled()
            // Before the first choice there is nothing to go back to, so esc leaves.
            if (focus() === 0) props.onQuit()
            else goBack()
        }
    })

    const radio = (checked: boolean) => (checked ? "●" : "○")

    // A locked choice keeps its layout: no cursor, muted text, and the chosen option colored.
    const choiceBlock = (choice: Choice, index: number) => {
        const locked = () => index < focus()
        return (
            <box flexDirection="column" gap={1} onMouseDown={() => locked() && setFocus(index)}>
                <Show when={choice.question}>
                    {(question: () => string) => (
                        <text fg={locked() ? colors().textMuted : colors().text}>{question()}</text>
                    )}
                </Show>
                <box flexDirection="column">
                    <For each={choice.options}>
                        {(option, optionIndex) => {
                            const selected = () => choice.selected() === optionIndex()
                            const labelColor = () => {
                                if (locked() && !selected()) return colors().textMuted
                                if (locked())
                                    return option.danger ? colors().error : colors().primary
                                return colors().text
                            }
                            return (
                                <box
                                    flexDirection="row"
                                    paddingLeft={1}
                                    paddingRight={1}
                                    backgroundColor={
                                        selected() && !locked()
                                            ? colors().selectionBackground
                                            : undefined
                                    }
                                    onMouseDown={() => {
                                        if (!locked()) choice.select(optionIndex())
                                    }}
                                >
                                    <box width={28}>
                                        <text fg={labelColor()}>
                                            {radio(selected())}{" "}
                                            <Show when={option.command}>
                                                <span style={{ fg: colors().textMuted }}>$ </span>
                                            </Show>
                                            {option.label}
                                        </text>
                                    </box>
                                    <Show when={option.description}>
                                        {(description: () => string) => (
                                            <text fg={colors().textMuted}>{description()}</text>
                                        )}
                                    </Show>
                                </box>
                            )
                        }}
                    </For>
                </box>
            </box>
        )
    }

    // Answered choices stay in place above the current one.
    const visibleChoices = () =>
        choices()
            .slice(0, focus() + 1)
            .map((choice, index) => ({ choice, index }))

    const choiceView = () => (
        <>
            <For each={visibleChoices()}>{(entry) => choiceBlock(entry.choice, entry.index)}</For>
            <FooterHints
                hints={[
                    { key: "esc", label: focus() > 0 ? "back" : "quit" },
                    ...(currentChoice().options.length > 1 ? [{ key: "↑↓", label: "choose" }] : []),
                    { key: "enter", label: onLastChoice() ? "run" : "next" },
                ]}
            />
        </>
    )

    const logView = () => (
        <box flexDirection="column" gap={1}>
            <Show
                when={logEntries().length > 0}
                fallback={<text fg={colors().textMuted}>{spinner()} Preparing recovery…</text>}
            >
                <box flexDirection="column">
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
                                        {entry.command ?? entry.message}
                                    </text>
                                    <Show when={entry.output.trimEnd()}>
                                        {(output: () => string) => (
                                            <box paddingLeft={2}>
                                                <text fg={colors().textMuted} wrapMode="word">
                                                    {output()}
                                                </text>
                                            </box>
                                        )}
                                    </Show>
                                </box>
                            )
                        }}
                    </For>
                </box>
            </Show>
            <Show when={unreportedError()}>
                {(message: () => string) => (
                    <text fg={colors().error} wrapMode="word">
                        {message()}
                    </text>
                )}
            </Show>
            <Show when={!running() && error()}>
                <FooterHints hints={[{ key: "esc", label: "back" }]} />
            </Show>
        </box>
    )

    const title = () =>
        showRecoveryLog()
            ? error()
                ? "Recovery failed"
                : "Recovering repository"
            : "Broken repository metadata"
    const titleColor = () => (showRecoveryLog() && !error() ? colors().primary : colors().error)

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
                <box flexDirection="row">
                    <text fg={titleColor()} attributes={TextAttributes.BOLD}>
                        {title()}
                    </text>
                    <box flexGrow={1} />
                </box>
                <Show
                    when={!showRecoveryLog()}
                    fallback={<text fg={colors().textMuted}>{displayPath()}</text>}
                >
                    <box flexDirection="column">
                        <text fg={colors().text} wrapMode="word">
                            Cannot open {markerNames()} in {displayPath()}.
                        </text>
                        <text fg={colors().textMuted} wrapMode="word">
                            {consequence()}
                        </text>
                    </box>
                </Show>
                <Show when={!showRecoveryLog()} fallback={logView()}>
                    {choiceView()}
                </Show>
            </box>
        </box>
    )
}
