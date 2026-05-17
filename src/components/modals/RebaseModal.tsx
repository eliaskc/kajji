import { useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import { type Commit, getRevisionId } from "../../commander/types"
import { useDialog } from "../../context/dialog"
import { RevisionPicker } from "../RevisionPicker"

export type RebaseMode = "revision" | "descendants" | "branch"
export type RebaseTargetMode = "onto" | "insertAfter" | "insertBefore"

export interface RebaseOptions {
    mode: RebaseMode
    targetMode: RebaseTargetMode
    skipEmptied: boolean
}

interface RebaseModalProps {
    source: Commit
    commits: Commit[]
    defaultTarget?: string
    height?: number
    onRebase: (target: string, options: RebaseOptions) => void
}

export function RebaseModal(props: RebaseModalProps) {
    const dialog = useDialog()

    const [selectedRevision, setSelectedRevision] = createSignal(
        props.defaultTarget ??
            (props.commits[0] ? getRevisionId(props.commits[0]) : ""),
    )

    let executing = false

    const executeRebase = (options: Partial<RebaseOptions> = {}) => {
        if (executing) return
        const target = selectedRevision()
        if (!target) return
        executing = true
        dialog.close()
        props.onRebase(target, {
            mode: options.mode ?? "revision",
            targetMode: options.targetMode ?? "onto",
            skipEmptied: options.skipEmptied ?? false,
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
            executeRebase()
        } else if (evt.name === "s" && !evt.shift) {
            evt.preventDefault()
            evt.stopPropagation()
            executeRebase({ mode: "descendants" })
        } else if (evt.name === "b" && !evt.shift) {
            evt.preventDefault()
            evt.stopPropagation()
            executeRebase({ mode: "branch" })
        } else if (evt.name === "e" && !evt.shift) {
            evt.preventDefault()
            evt.stopPropagation()
            executeRebase({ skipEmptied: true })
        } else if (evt.name === "a" && evt.shift) {
            evt.preventDefault()
            evt.stopPropagation()
            executeRebase({ targetMode: "insertAfter" })
        } else if (evt.name === "b" && evt.shift) {
            evt.preventDefault()
            evt.stopPropagation()
            executeRebase({ targetMode: "insertBefore" })
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
