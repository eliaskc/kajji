import { useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import { type Commit, getRevisionId } from "../../commander/types"
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

    useKeyboard((evt) => {
        if (executing) return
        if (evt.name === "escape") {
            evt.preventDefault()
            evt.stopPropagation()
            dialog.close()
        } else if (evt.name === "return") {
            evt.preventDefault()
            evt.stopPropagation()
            executeSquash()
        } else if (evt.name === "u") {
            evt.preventDefault()
            evt.stopPropagation()
            executeSquash({ useDestinationMessage: true })
        } else if (evt.name === "k" && evt.shift) {
            evt.preventDefault()
            evt.stopPropagation()
            executeSquash({ keepEmptied: true })
        } else if (evt.name === "i") {
            evt.preventDefault()
            evt.stopPropagation()
            executeSquash({ interactive: true })
        }
    })

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
