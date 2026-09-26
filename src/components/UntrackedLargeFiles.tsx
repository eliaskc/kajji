import { For, Show, createMemo } from "solid-js"
import type { UntrackedLargeFile } from "../commander/snapshot-warnings"
import { useTheme } from "../context/theme"
import { truncatePathMiddle } from "../utils/path-truncate"
import {
    REFUSED_TO_SNAPSHOT,
    formatByteSize,
    sharedSizeLimit,
    untrackedLargeFilesLimitText,
    untrackedLargeFilesShortTitle,
    untrackedLargeFilesTitle,
} from "../utils/untracked-large-files"

const MAX_VISIBLE_FILES = 5
const MIN_PATH_WIDTH = 8

/** Lists new working-copy files that jj did not snapshot because they are too large. */
export function UntrackedLargeFiles(props: {
    files: readonly UntrackedLargeFile[]
    maxWidth: number
    /** `?` marker and a short title, for the narrow files panel. */
    compact?: boolean
    /**
     * Shared path column with the file stats below. Rows use the same ` | ` separator
     * and the title uses a warning-colored ` | ` in that column, so everything lines up.
     */
    pathColumnWidth?: number
}) {
    const { colors } = useTheme()
    const visible = () => props.files.slice(0, MAX_VISIBLE_FILES)
    const prefix = () => (props.compact ? "? " : "")
    const separator = () => (props.pathColumnWidth === undefined ? "  " : " | ")
    const sizes = createMemo(() => visible().map((file) => formatByteSize(file.size)))
    const sizeWidth = () => separator().length + Math.max(0, ...sizes().map((size) => size.length))
    // Keep paths readable in narrow panels; drop the sizes first.
    const showSizes = () => props.maxWidth - prefix().length - sizeWidth() >= MIN_PATH_WIDTH
    const pathWidth = () =>
        Math.max(1, props.maxWidth - prefix().length - (showSizes() ? sizeWidth() : 0))
    // Sizes line up in one column after the longest visible path.
    const pathColumn = () =>
        props.pathColumnWidth ??
        Math.min(pathWidth(), Math.max(1, ...visible().map((file) => file.path.length)))
    const overflow = () => props.files.length - visible().length
    const limit = () => sharedSizeLimit(props.files)
    const title = () => {
        if (props.compact) return untrackedLargeFilesShortTitle(limit())
        const column = props.pathColumnWidth
        if (column === undefined) return untrackedLargeFilesTitle(limit())
        return `${REFUSED_TO_SNAPSHOT.padEnd(column)} | ${untrackedLargeFilesLimitText(limit())}`
    }

    return (
        <box flexDirection="column" flexShrink={0}>
            <text fg={colors().warning} wrapMode="none">
                {title()}
            </text>
            <For each={visible()}>
                {(file, index) => {
                    const path = () => truncatePathMiddle(file.path, pathColumn())
                    const nameStart = () => path().lastIndexOf("/") + 1
                    const padding = () => " ".repeat(Math.max(0, pathColumn() - path().length))
                    const size = () => (showSizes() ? (sizes()[index()] ?? "") : "")
                    return (
                        <text wrapMode="none">
                            <span style={{ fg: colors().warning }}>{prefix()}</span>
                            <span style={{ fg: colors().textMuted }}>
                                {path().slice(0, nameStart())}
                            </span>
                            <span style={{ fg: colors().text }}>{path().slice(nameStart())}</span>
                            <span style={{ fg: colors().textMuted }}>{padding()}</span>
                            <Show when={showSizes()}>
                                {separator()}
                                <span style={{ fg: colors().text }}>{size()}</span>
                            </Show>
                        </text>
                    )
                }}
            </For>
            <Show when={overflow() > 0}>
                <text fg={colors().textMuted} wrapMode="none">
                    {`…and ${overflow()} more`}
                </text>
            </Show>
        </box>
    )
}
