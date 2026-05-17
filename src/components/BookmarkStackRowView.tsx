import { ptyToJson } from "ghostty-opentui"
import { For, Show } from "solid-js"
import type { Bookmark } from "../commander/bookmarks"
import { useTheme } from "../context/theme"
import type { BookmarkStackRow } from "../stack/model"
import { resolveAnsiForeground } from "../theme/ansi"

const emptyDescriptionPrefix = "(empty) "

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

interface BookmarkStackRowViewProps {
    row: BookmarkStackRow<Bookmark>
    selected?: boolean
    prNumber?: number
    showOriginChanged?: boolean
    showRemote?: boolean
}

export function BookmarkStackRowView(props: BookmarkStackRowViewProps) {
    const { colors, mode } = useTheme()

    const inlineAnsiSpans = (content: string, defaultFg?: string) => {
        const spans =
            ptyToJson(content, { cols: 9999, rows: 1 }).lines[0]?.spans ?? []
        return spans
            .filter((span) => span.text.length > 0)
            .map((span) => ({
                text: span.text,
                fg: resolveAnsiForeground({
                    fg: span.fg,
                    mode: mode(),
                    text: colors().text,
                    textMuted: colors().textMuted,
                    defaultFg,
                }),
                bg: span.bg ?? undefined,
            }))
    }

    const bookmark = () => props.row.bookmark
    const isDeleted = () => !bookmark().changeId
    const selectedFg = () =>
        props.selected ? colors().selectionText : undefined
    const bookmarkNameFg = (defaultFg?: string) =>
        inlineAnsiSpans(
            bookmark().nameDisplay || bookmark().name,
            defaultFg,
        ).at(-1)?.fg ??
        defaultFg ??
        colors().text

    return (
        <box flexDirection="row" flexGrow={1} overflow="hidden">
            <box flexShrink={0} overflow="hidden">
                <text wrapMode="none">
                    <Show when={props.row.depth > 0}>
                        <span style={{ fg: colors().textMuted }}>
                            {"  ".repeat(Math.max(0, props.row.depth - 1))}↳{" "}
                        </span>
                    </Show>
                    <For
                        each={inlineAnsiSpans(
                            bookmark().nameDisplay || bookmark().name,
                            selectedFg(),
                        )}
                    >
                        {(span) => (
                            <span style={{ fg: span.fg, bg: span.bg }}>
                                {span.text}
                            </span>
                        )}
                    </For>
                    <Show when={bookmark().isLocal && props.showOriginChanged}>
                        <span style={{ fg: bookmarkNameFg(selectedFg()) }}>
                            *
                        </span>
                    </Show>
                    <Show when={props.prNumber}>
                        <span style={{ fg: colors().textMuted }}>
                            {` #${props.prNumber}`}
                        </span>
                    </Show>
                    <Show
                        when={!isDeleted()}
                        fallback={
                            <span style={{ fg: colors().error }}>
                                {" –deleted "}
                            </span>
                        }
                    >
                        <span style={{ fg: colors().textMuted }}> </span>
                        <For
                            each={inlineAnsiSpans(
                                bookmark().changeIdDisplay ||
                                    bookmark().changeId,
                                props.selected
                                    ? colors().selectionText
                                    : colors().textMuted,
                            )}
                        >
                            {(span) => (
                                <span style={{ fg: span.fg, bg: span.bg }}>
                                    {span.text}
                                </span>
                            )}
                        </For>
                        <span style={{ fg: colors().textMuted }}> </span>
                    </Show>
                    <Show when={props.showRemote && bookmark().remote}>
                        <span style={{ fg: colors().textMuted }}>
                            @{bookmark().remote}{" "}
                        </span>
                    </Show>
                </text>
            </box>
            <Show when={!isDeleted()}>
                <box flexDirection="row" flexGrow={1} overflow="hidden">
                    <Show
                        when={stripAnsi(
                            bookmark().descriptionDisplay,
                        ).startsWith(emptyDescriptionPrefix)}
                        fallback={
                            <text
                                fg={colors().textMuted}
                                content={bookmark().description}
                                wrapMode="none"
                            />
                        }
                    >
                        <box
                            width={emptyDescriptionPrefix.length}
                            flexShrink={0}
                        >
                            <text
                                fg={colors().success}
                                content={emptyDescriptionPrefix}
                                wrapMode="none"
                            />
                        </box>
                        <box flexGrow={1} overflow="hidden">
                            <text
                                fg={colors().textMuted}
                                content={bookmark().description.slice(
                                    emptyDescriptionPrefix.length,
                                )}
                                wrapMode="none"
                            />
                        </box>
                    </Show>
                </box>
            </Show>
        </box>
    )
}
