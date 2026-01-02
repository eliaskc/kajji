import { useKeyboard } from "@opentui/solid"
import { Show, createResource } from "solid-js"
import { fetchOpLog } from "../../commander/operations"
import { useTheme } from "../../context/theme"
import { AnsiText } from "../AnsiText"
import { BorderBox } from "../BorderBox"

interface UndoModalProps {
	type: "undo" | "redo" | "restore"
	operationLines?: string[]
	onConfirm: () => void
	onCancel: () => void
}

export function UndoModal(props: UndoModalProps) {
	const { colors, style } = useTheme()

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
			props.onConfirm()
		} else if (evt.name === "n" || evt.name === "escape") {
			evt.preventDefault()
			props.onCancel()
		}
	})

	const title = () => {
		if (props.type === "restore") return "Restore to this operation?"
		return props.type === "undo"
			? "Undo last operation?"
			: "Redo last operation?"
	}

	const hints = () => (
		<text>
			<span style={{ fg: colors().primary }}>y</span>
			<span style={{ fg: colors().textMuted }}> confirm </span>
			<span style={{ fg: colors().primary }}>n</span>
			<span style={{ fg: colors().textMuted }}> cancel</span>
		</text>
	)

	return (
		<BorderBox
			border
			borderStyle={style().panel.borderStyle}
			borderColor={colors().borderFocused}
			backgroundColor={colors().background}
			width="60%"
			topLeft={<text fg={colors().text}>{title()}</text>}
			bottomRight={hints()}
			paddingLeft={1}
			paddingRight={1}
		>
			<Show when={fetchedDetails.loading && !props.operationLines}>
				<text fg={colors().textMuted}>Loading...</text>
			</Show>
			<Show when={!fetchedDetails.loading || props.operationLines}>
				<AnsiText content={opDetails()} wrapMode="none" />
			</Show>
		</BorderBox>
	)
}
