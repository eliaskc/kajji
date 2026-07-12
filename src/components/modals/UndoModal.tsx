import { Show, createResource } from "solid-js"
import { fetchOpLog } from "../../commander/operations"
import { useDialogCommands } from "../../context/command"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { AnsiText } from "../AnsiText"

interface UndoModalProps {
    type: "undo" | "redo" | "restore"
    operationLines?: string[]
    onConfirm: () => void
    onCancel: () => void
}

export function UndoModal(props: UndoModalProps) {
    const { colors } = useTheme()
    const dialog = useDialog()
    const dialogId = dialog.currentId()

    const [fetchedDetails] = createResource(
        () => !props.operationLines,
        async () => {
            const lines = await fetchOpLog(1)
            return lines.join("\n")
        },
    )

    const opDetails = () =>
        props.operationLines?.join("\n") ?? fetchedDetails() ?? ""

    useDialogCommands(dialogId, () => [
        {
            id: `${dialogId}.confirm`,
            title: "confirm",
            keybind: "dialog_confirm",
            execute: props.onConfirm,
        },
        {
            id: `${dialogId}.cancel`,
            title: "cancel",
            keybind: "dialog_cancel",
            execute: props.onCancel,
        },
    ])

    return (
        <box flexDirection="column">
            <Show when={fetchedDetails.loading && !props.operationLines}>
                <text fg={colors().textMuted}>Loading...</text>
            </Show>
            <Show when={!fetchedDetails.loading || props.operationLines}>
                <AnsiText content={opDetails()} wrapMode="none" />
            </Show>
        </box>
    )
}
