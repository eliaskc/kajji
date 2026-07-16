import { Show } from "solid-js"
import { useTheme } from "../../context/theme"
import type { FlattenedFile } from "../../diff"
import { splitDisplayPath, truncatePathMiddle } from "../../utils/path-truncate"
import {
    type DiffFileStatus,
    getDiffStatusKey,
    getStatusColor,
} from "../../utils/status-colors"

const ADDITION_COLOR = "#3fb950"
const DELETION_COLOR = "#f85149"
const FILE_HEADER_PREFIX = "▌ "

export function DiffFileHeader(props: {
    file: FlattenedFile
    maxWidth: number
}) {
    const { colors } = useTheme()
    const statsWidth = () =>
        (props.file.additions ? `+${props.file.additions}`.length : 0) +
        (props.file.deletions ? `-${props.file.deletions}`.length : 0) +
        (props.file.additions && props.file.deletions ? 1 : 0)
    const previousName = () =>
        props.file.prevName ? ` ← ${props.file.prevName}` : ""
    const statusColor = () =>
        getStatusColor(
            getDiffStatusKey(props.file.type as DiffFileStatus),
            colors(),
        )
    const headerText = () =>
        truncatePathMiddle(
            `${props.file.name}${previousName()}`,
            Math.max(
                1,
                props.maxWidth - statsWidth() - FILE_HEADER_PREFIX.length - 1,
            ),
        )
    const headerSegments = () => splitDisplayPath(headerText())

    return (
        <box
            width={props.maxWidth + 4}
            flexDirection="row"
            justifyContent="space-between"
            backgroundColor={colors().background}
            paddingRight={1}
        >
            <text fg={statusColor()} flexShrink={0}>
                {FILE_HEADER_PREFIX}
            </text>
            <text wrapMode="none" flexShrink={0}>
                <span style={{ fg: colors().textMuted }}>
                    {headerSegments().directory}
                </span>
                <span style={{ fg: colors().text }}>
                    {headerSegments().fileName}
                </span>
                <span style={{ fg: colors().textMuted }}>
                    {headerSegments().suffix}
                </span>
            </text>
            <text wrapMode="none" flexGrow={1} fg={colors().backgroundElement}>
                {"─".repeat(props.maxWidth)}
            </text>
            <text wrapMode="none" flexShrink={0}>
                <Show when={props.file.additions > 0}>
                    <span style={{ fg: ADDITION_COLOR }}>
                        +{props.file.additions}
                    </span>
                </Show>
                <Show
                    when={props.file.additions > 0 && props.file.deletions > 0}
                >
                    <span> </span>
                </Show>
                <Show when={props.file.deletions > 0}>
                    <span style={{ fg: DELETION_COLOR }}>
                        -{props.file.deletions}
                    </span>
                </Show>
            </text>
        </box>
    )
}
