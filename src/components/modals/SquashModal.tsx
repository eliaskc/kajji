import { createSignal } from "solid-js"
import { type Commit, getRevisionId } from "../../commander/types"
import { useDialogCommands } from "../../context/command"
import { useDialog } from "../../context/dialog"
import { RevisionPicker } from "../RevisionPicker"

export interface SquashOptions {
    useDestinationMessage: boolean
    keepEmptied: boolean
    interactive: boolean
}

interface SquashModalProps {
    source: Commit
    commits: Commit[]
    defaultTarget?: string
    height?: number
    onSquash: (target: string, options: SquashOptions) => void
}

export function SquashModal(props: SquashModalProps) {
    const dialog = useDialog()

    const [selectedRevision, setSelectedRevision] = createSignal(
        props.defaultTarget ??
            (props.commits[0] ? getRevisionId(props.commits[0]) : ""),
    )

    let executing = false

    const executeSquash = (options: Partial<SquashOptions> = {}) => {
        if (executing) return
        const target = selectedRevision()
        if (!target) return
        executing = true
        dialog.close()
        props.onSquash(target, {
            useDestinationMessage: options.useDestinationMessage ?? false,
            keepEmptied: options.keepEmptied ?? false,
            interactive: options.interactive ?? false,
        })
    }

    const dialogId = dialog.currentId()
    useDialogCommands(dialogId, () => [
        {
            id: `${dialogId}.destination-message`,
            title: "destination message",
            keybind: "squash_destination_message",
            execute: () => executeSquash({ useDestinationMessage: true }),
        },
        {
            id: `${dialogId}.keep-emptied`,
            title: "keep emptied",
            keybind: "squash_keep_emptied",
            execute: () => executeSquash({ keepEmptied: true }),
        },
        {
            id: `${dialogId}.interactive`,
            title: "interactive",
            keybind: "squash_interactive",
            execute: () => executeSquash({ interactive: true }),
        },
        {
            id: `${dialogId}.confirm`,
            title: "squash",
            keybind: "enter",
            execute: executeSquash,
        },
    ])

    const handleRevisionSelect = (commit: Commit) => {
        setSelectedRevision(getRevisionId(commit))
    }

    const pickerHeight = () => props.height ?? 18

    return (
        <box flexDirection="column" height={pickerHeight()}>
            <RevisionPicker
                commits={props.commits}
                defaultRevision={props.defaultTarget}
                focused={true}
                onSelect={handleRevisionSelect}
                height={pickerHeight()}
            />
        </box>
    )
}
