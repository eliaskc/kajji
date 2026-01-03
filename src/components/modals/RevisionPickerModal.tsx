import { useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Commit } from "../../commander/types"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { RevisionPicker } from "../RevisionPicker"

interface RevisionPickerModalProps {
	title: string
	commits: Commit[]
	defaultRevision?: string
	width?: number | "auto" | `${number}%`
	height?: number
	onSelect: (revision: string) => void
}

export function RevisionPickerModal(props: RevisionPickerModalProps) {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const [selectedRevision, setSelectedRevision] = createSignal(
		props.defaultRevision ?? props.commits[0]?.changeId ?? "",
	)

	const handleConfirm = () => {
		const rev = selectedRevision()
		if (!rev) return
		dialog.close()
		props.onSelect(rev)
	}

	useKeyboard((evt) => {
		if (evt.name === "escape") {
			evt.preventDefault()
			dialog.close()
		} else if (evt.name === "return") {
			evt.preventDefault()
			handleConfirm()
		}
	})

	const handleRevisionSelect = (commit: Commit) => {
		setSelectedRevision(commit.changeId)
	}

	const pickerHeight = () => props.height ?? 12

	return (
		<box flexDirection="column" width={props.width ?? "60%"} gap={0}>
			<box
				flexDirection="column"
				border
				borderStyle={style().panel.borderStyle}
				borderColor={colors().borderFocused}
				backgroundColor={colors().background}
				height={pickerHeight()}
				padding={0}
				title={props.title}
			>
				<RevisionPicker
					commits={props.commits}
					defaultRevision={props.defaultRevision}
					focused={true}
					onSelect={handleRevisionSelect}
					height={pickerHeight() - 2}
				/>
			</box>
		</box>
	)
}
