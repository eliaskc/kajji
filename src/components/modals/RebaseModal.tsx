import { useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Commit } from "../../commander/types"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { BorderBox } from "../BorderBox"
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
	width?: number | "auto" | `${number}%`
	height?: number
	onRebase: (target: string, options: RebaseOptions) => void
}

export function RebaseModal(props: RebaseModalProps) {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const [selectedRevision, setSelectedRevision] = createSignal(
		props.defaultTarget ?? props.commits[0]?.changeId ?? "",
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
		} else if (evt.name === "s") {
			evt.preventDefault()
			evt.stopPropagation()
			executeRebase({ mode: "descendants" })
		} else if (evt.name === "b") {
			evt.preventDefault()
			evt.stopPropagation()
			executeRebase({ mode: "branch" })
		} else if (evt.name === "e") {
			evt.preventDefault()
			evt.stopPropagation()
			executeRebase({ skipEmptied: true })
		} else if (evt.name === "a") {
			evt.preventDefault()
			evt.stopPropagation()
			executeRebase({ targetMode: "insertAfter" })
		} else if (evt.name === "B") {
			evt.preventDefault()
			evt.stopPropagation()
			executeRebase({ targetMode: "insertBefore" })
		}
	})

	const handleRevisionSelect = (commit: Commit) => {
		setSelectedRevision(commit.changeId)
	}

	const pickerHeight = () => props.height ?? 12

	const title = () => `Rebase ${props.source.changeId.slice(0, 8)} onto`

	return (
		<box
			flexDirection="column"
			width={props.width ?? "60%"}
			maxWidth={90}
			gap={0}
		>
			<BorderBox
				border
				borderStyle={style().panel.borderStyle}
				borderColor={colors().borderFocused}
				backgroundColor={colors().background}
				height={pickerHeight()}
				topLeft={<text fg={colors().borderFocused}>{title()}</text>}
			>
				<RevisionPicker
					commits={props.commits}
					defaultRevision={props.defaultTarget}
					focused={true}
					onSelect={handleRevisionSelect}
					height={pickerHeight() - 2}
				/>
			</BorderBox>
		</box>
	)
}
