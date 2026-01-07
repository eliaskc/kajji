import { For, Show, createMemo } from "solid-js"
import { useTheme } from "../../context/theme"
import {
	type FileId,
	type FlattenedFile,
	getFileStatusColor,
	getFileStatusIndicator,
} from "../../diff"

const STAT_COLORS = {
	addition: "#3fb950",
	deletion: "#f85149",
}
const SEPARATOR_COLOR = "#30363d"

interface FileListProps {
	files: FlattenedFile[]
	activeFileId: FileId | null
	onSelectFile: (fileId: FileId) => void
	focused?: boolean
}

/**
 * File list/navigator for file-at-a-time diff viewing.
 */
export function FileList(props: FileListProps) {
	const { colors } = useTheme()

	return (
		<box flexDirection="column">
			<For each={props.files}>
				{(file) => {
					const isActive = () => file.fileId === props.activeFileId
					const indicator = getFileStatusIndicator(file.type)
					const statusColor = getFileStatusColor(file.type)

					return (
						<box
							backgroundColor={
								isActive() && props.focused
									? colors().selectionBackground
									: undefined
							}
							onMouseDown={() => props.onSelectFile(file.fileId)}
						>
							<text wrapMode="none">
								<span style={{ fg: statusColor }}>{indicator}</span>
								<span
									style={{
										fg: isActive() ? colors().primary : colors().text,
									}}
								>
									{" "}
									{file.name}
								</span>
								<Show when={file.prevName}>
									<span style={{ fg: colors().textMuted }}>
										{" ← "}
										{file.prevName}
									</span>
								</Show>
								<span style={{ fg: SEPARATOR_COLOR }}> │ </span>
								<Show when={file.additions > 0}>
									<span style={{ fg: STAT_COLORS.addition }}>
										+{file.additions}
									</span>
								</Show>
								<Show when={file.additions > 0 && file.deletions > 0}>
									<span> </span>
								</Show>
								<Show when={file.deletions > 0}>
									<span style={{ fg: STAT_COLORS.deletion }}>
										-{file.deletions}
									</span>
								</Show>
							</text>
						</box>
					)
				}}
			</For>
			<Show when={props.files.length === 0}>
				<text fg={colors().textMuted}>No files</text>
			</Show>
		</box>
	)
}

/**
 * Compact file summary for header display.
 */
export function FileSummary(props: {
	files: FlattenedFile[]
	activeFileId: FileId | null
}) {
	const { colors } = useTheme()

	const totals = createMemo(() => {
		let additions = 0
		let deletions = 0
		for (const file of props.files) {
			additions += file.additions
			deletions += file.deletions
		}
		return { additions, deletions, files: props.files.length }
	})

	const activeIndex = createMemo(() => {
		if (!props.activeFileId) return 0
		const idx = props.files.findIndex((f) => f.fileId === props.activeFileId)
		return idx >= 0 ? idx + 1 : 0
	})

	return (
		<text>
			<span style={{ fg: colors().textMuted }}>
				File {activeIndex()}/{totals().files}
			</span>
			<span style={{ fg: SEPARATOR_COLOR }}> │ </span>
			<span style={{ fg: STAT_COLORS.addition }}>+{totals().additions}</span>
			<span> </span>
			<span style={{ fg: STAT_COLORS.deletion }}>-{totals().deletions}</span>
		</text>
	)
}
