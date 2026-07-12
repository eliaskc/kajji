import { createSignal } from "solid-js"
import { type Commit, getRevisionId } from "../../commander/types"
import { useDialogCommands } from "../../context/command"
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

    const dialogId = dialog.currentId()
    useDialogCommands(dialogId, () => [
        {
            id: `${dialogId}.descendants`,
            title: "descendants",
            keybind: "rebase_descendants",
            execute: () => executeRebase({ mode: "descendants" }),
        },
        {
            id: `${dialogId}.branch`,
            title: "branch",
            keybind: "rebase_branch",
            execute: () => executeRebase({ mode: "branch" }),
        },
        {
            id: `${dialogId}.skip-emptied`,
            title: "skip emptied",
            keybind: "rebase_skip_emptied",
            execute: () => executeRebase({ skipEmptied: true }),
        },
        {
            id: `${dialogId}.insert-after`,
            title: "insert after",
            keybind: "rebase_insert_after",
            execute: () => executeRebase({ targetMode: "insertAfter" }),
        },
        {
            id: `${dialogId}.insert-before`,
            title: "insert before",
            keybind: "rebase_insert_before",
            execute: () => executeRebase({ targetMode: "insertBefore" }),
        },
        {
            id: `${dialogId}.confirm`,
            title: "rebase",
            keybind: "enter",
            execute: executeRebase,
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
