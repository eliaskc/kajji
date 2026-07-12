import { createSignal } from "solid-js"
import { type Commit, getRevisionId } from "../../commander/types"
import { useDialogCommands } from "../../context/command"
import { useDialog } from "../../context/dialog"
import { RevisionPicker } from "../RevisionPicker"

interface RevisionPickerModalProps {
    commits: Commit[]
    defaultRevision?: string
    height?: number
    onSelect: (revision: string) => void
}

export function RevisionPickerModal(props: RevisionPickerModalProps) {
    const dialog = useDialog()

    const [selectedRevision, setSelectedRevision] = createSignal(
        props.defaultRevision ??
            (props.commits[0] ? getRevisionId(props.commits[0]) : ""),
    )

    const handleConfirm = () => {
        const rev = selectedRevision()
        if (!rev) return
        dialog.close()
        props.onSelect(rev)
    }

    const dialogId = dialog.currentId()
    useDialogCommands(dialogId, () => [
        {
            id: `${dialogId}.confirm`,
            title: "select",
            keybind: "enter",
            execute: handleConfirm,
        },
    ])

    const handleRevisionSelect = (commit: Commit) => {
        setSelectedRevision(getRevisionId(commit))
    }

    const pickerHeight = () => props.height ?? 12

    return (
        <box flexDirection="column" height={pickerHeight()}>
            <RevisionPicker
                commits={props.commits}
                defaultRevision={props.defaultRevision}
                focused={true}
                onSelect={handleRevisionSelect}
                height={pickerHeight()}
            />
        </box>
    )
}
