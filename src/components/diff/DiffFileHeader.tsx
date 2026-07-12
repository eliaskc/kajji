import { Show } from "solid-js"
import { useTheme } from "../../context/theme"
import type { FlattenedFile } from "../../diff"
import { truncatePathMiddle } from "../../utils/path-truncate"

const ADDITION_COLOR = "#3fb950"
const DELETION_COLOR = "#f85149"

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
    const headerText = () =>
        truncatePathMiddle(
            `${props.file.name}${previousName()}`,
            Math.max(1, props.maxWidth - statsWidth() - 1),
        )

    return (
        <box
            flexDirection="row"
            justifyContent="space-between"
            backgroundColor={colors().background}
            paddingRight={1}
        >
            <text wrapMode="none">
                <span style={{ fg: colors().text }}>{headerText()}</span>
            </text>
            <text>
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
