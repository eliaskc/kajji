import { useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Commit } from "../../commander/types"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { BorderBox } from "../BorderBox"
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
	width?: number | "auto" | `${number}%`
	height?: number
	onSquash: (target: string, options: SquashOptions) => void
}

export function SquashModal(props: SquashModalProps) {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const [selectedRevision, setSelectedRevision] = createSignal(
		props.defaultTarget ?? props.commits[0]?.changeId ?? "",
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
		// Only handle our specific keys, let RevisionPicker handle j/k navigation
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
		} else if (evt.name === "K") {
			// Shift+K for keep-emptied (k conflicts with navigation)
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
		setSelectedRevision(commit.changeId)
	}

	const pickerHeight = () => props.height ?? 12

	const title = () => `Squash ${props.source.changeId.slice(0, 8)} into`

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
