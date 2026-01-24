import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import {
	type FileId,
	type FlattenedFile,
	getFileStatusIndicator,
} from "../../diff"
import { getDiffStatusKey, getStatusColor } from "../../utils/status-colors"

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
					const statusColor = getStatusColor(
						getDiffStatusKey(file.type),
						colors(),
					)

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
