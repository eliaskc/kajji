import { useKeyboard } from "@opentui/solid"
import { Show, createResource } from "solid-js"
import { fetchOpLog } from "../../commander/operations"
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

    const [fetchedDetails] = createResource(
        () => !props.operationLines,
        async () => {
            const lines = await fetchOpLog(1)
            return lines.join("\n")
        },
    )

    const opDetails = () =>
        props.operationLines?.join("\n") ?? fetchedDetails() ?? ""

    useKeyboard((evt) => {
        if (evt.name === "y" || evt.name === "return") {
            evt.preventDefault()
            evt.stopPropagation()
            props.onConfirm()
        } else if (evt.name === "n" || evt.name === "escape") {
            evt.preventDefault()
            evt.stopPropagation()
            props.onCancel()
        }
    })

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
