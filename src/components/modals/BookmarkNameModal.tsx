import { RGBA, type TextareaRenderable } from "@opentui/core"
import { Show, createSignal, onMount } from "solid-js"
import { type Commit, getRevisionId } from "../../commander/types"
import { useCommandInputGuard, useDialogCommands } from "../../context/command"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { RevisionPicker } from "../RevisionPicker"

const SINGLE_LINE_KEYBINDINGS = [
    { name: "return", action: "submit" as const },
    { name: "enter", action: "submit" as const },
]

interface BookmarkNameModalProps {
    commits?: Commit[]
    defaultRevision?: string
    initialValue?: string
    placeholder?: string
    height?: number
    onSave: (name: string, revision?: string) => void
}

export function BookmarkNameModal(props: BookmarkNameModalProps) {
    const dialog = useDialog()
    const { colors } = useTheme()
    useCommandInputGuard()

    const hasRevisionPicker = () => (props.commits?.length ?? 0) > 0

    const [selectedRevision, setSelectedRevision] = createSignal(
        props.defaultRevision ??
            (props.commits?.[0] ? getRevisionId(props.commits[0]) : ""),
    )
    const [name, setName] = createSignal(props.initialValue ?? "")
    const [error, setError] = createSignal<string | null>(null)
    const [focusedField, setFocusedField] = createSignal<"name" | "picker">(
        "name",
    )

    let inputRef: TextareaRenderable | undefined

    const focusInputAtEnd = (ref: TextareaRenderable | undefined) => {
        if (!ref) return
        ref.focus()
        ref.gotoBufferEnd()
    }

    onMount(() => {
        setTimeout(() => {
            inputRef?.requestRender?.()
            focusInputAtEnd(inputRef)
        }, 1)
    })

    const generatedName = () => {
        if (!hasRevisionPicker()) return props.placeholder ?? ""
        const rev = selectedRevision()
        return rev ? `push-${rev.slice(0, 8)}` : "push-bookmark"
    }

    const handleSave = () => {
        const trimmed = name().trim()
        const finalName = trimmed || generatedName()

        if (!finalName) {
            setError("Name cannot be empty")
            return
        }
        if (/\s/.test(finalName)) {
            setError("Name cannot contain spaces")
            return
        }

        dialog.close()
        if (hasRevisionPicker()) {
            props.onSave(finalName, selectedRevision())
        } else {
            props.onSave(finalName)
        }
    }

    const dialogId = dialog.currentId()
    useDialogCommands(dialogId, () => {
        if (!hasRevisionPicker()) {
            return [
                {
                    id: `${dialogId}.save`,
                    title: "save",
                    keybind: "enter",
                    execute: handleSave,
                },
            ]
        }
        return [
            {
                id: `${dialogId}.next-field`,
                title: "next field",
                keybind: "focus_next",
                allowInInput: true,
                execute: () => {
                    if (focusedField() === "name") {
                        setFocusedField("picker")
                    } else {
                        setFocusedField("name")
                        focusInputAtEnd(inputRef)
                    }
                },
            },
            {
                id: `${dialogId}.save`,
                title: "save",
                keybind: "enter",
                allowInInput: focusedField() === "picker",
                execute: handleSave,
            },
        ]
    })

    const handleRevisionSelect = (commit: Commit) => {
        setSelectedRevision(getRevisionId(commit))
    }

    const pickerHeight = () => props.height ?? 10

    return (
        <box flexDirection="column" gap={1}>
            <textarea
                ref={(r) => {
                    inputRef = r
                }}
                initialValue={props.initialValue ?? ""}
                placeholder={generatedName() || "Name"}
                placeholderColor={colors().textMuted}
                onContentChange={() => {
                    if (inputRef) {
                        setName(inputRef.plainText)
                        setError(null)
                    }
                }}
                onSubmit={handleSave}
                keyBindings={SINGLE_LINE_KEYBINDINGS}
                wrapMode="none"
                scrollMargin={0}
                cursorColor={colors().primary}
                textColor={colors().text}
                focusedTextColor={colors().text}
                focusedBackgroundColor={RGBA.fromInts(0, 0, 0, 0)}
                flexGrow={1}
            />

            <Show when={error()}>
                <text fg={colors().error}>{error()}</text>
            </Show>

            <Show when={hasRevisionPicker()}>
                <RevisionPicker
                    commits={props.commits ?? []}
                    defaultRevision={props.defaultRevision}
                    focused={focusedField() === "picker"}
                    onSelect={handleRevisionSelect}
                    height={pickerHeight()}
                />
            </Show>
        </box>
    )
}
