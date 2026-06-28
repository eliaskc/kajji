import { ptyToJson } from "ghostty-opentui"
import { For, Show } from "solid-js"
import type { Bookmark } from "../commander/bookmarks"
import { useTheme } from "../context/theme"
import type { BookmarkStackRow } from "../stack/model"
import { resolveAnsiForeground } from "../theme/ansi"
import { stripAnsi } from "../utils/ansi"
import { AnsiText } from "./AnsiText"

const emptyDescriptionPrefix = "(empty) "

interface BookmarkStackRowViewProps {
    row: BookmarkStackRow<Bookmark>
    selected?: boolean
    prNumber?: number
    showOriginChanged?: boolean
    showRemote?: boolean
    annotation?: string
    hideRevisionId?: boolean
    hideDescription?: boolean
    horizontalScroll?: {
        cropStart: number
        cropWidth: number
    }
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

    const scrollableContent = () => {
        if (isDeleted()) return "–deleted "
        const parts = []
        if (props.prNumber) parts.push(`#${props.prNumber}`)
        if (!props.hideRevisionId) {
            parts.push(bookmark().changeIdDisplay || bookmark().changeId)
        }
        if (props.showRemote && bookmark().remote) {
            parts.push(`@${bookmark().remote}`)
        }
        if (!props.hideDescription) {
            parts.push(
                props.annotation ??
                    bookmark().descriptionDisplay ??
                    bookmark().description,
            )
        }
        return parts.join(" ")
    }

    const contentFg = () => {
        if (props.selected) return colors().selectionText
        if (isDeleted()) return colors().error
        return props.annotation !== undefined
            ? colors().text
            : colors().textMuted
    }

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
                </text>
            </box>
            <Show
                when={props.horizontalScroll}
                fallback={
                    <>
                        <Show when={props.prNumber}>
                            <text fg={colors().textMuted} wrapMode="none">
                                {` #${props.prNumber}`}
                            </text>
                        </Show>
                        <Show
                            when={!isDeleted()}
                            fallback={
                                <text fg={colors().error} wrapMode="none">
                                    {" –deleted "}
                                </text>
                            }
                        >
                            <text fg={colors().textMuted} wrapMode="none">
                                {" "}
                            </text>
                            <Show when={!props.hideRevisionId}>
                                <text wrapMode="none">
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
                                            <span
                                                style={{
                                                    fg: span.fg,
                                                    bg: span.bg,
                                                }}
                                            >
                                                {span.text}
                                            </span>
                                        )}
                                    </For>
                                    <span style={{ fg: colors().textMuted }}>
                                        {" "}
                                    </span>
                                </text>
                            </Show>
                        </Show>
                        <Show when={props.showRemote && bookmark().remote}>
                            <text fg={colors().textMuted} wrapMode="none">
                                @{bookmark().remote}{" "}
                            </text>
                        </Show>
                        <Show when={!isDeleted() && !props.hideDescription}>
                            <box
                                flexDirection="row"
                                flexGrow={1}
                                overflow="hidden"
                            >
                                <Show
                                    when={props.annotation !== undefined}
                                    fallback={
                                        <Show
                                            when={stripAnsi(
                                                bookmark().descriptionDisplay,
                                            ).startsWith(
                                                emptyDescriptionPrefix,
                                            )}
                                            fallback={
                                                <text
                                                    fg={colors().textMuted}
                                                    content={
                                                        bookmark().description
                                                    }
                                                    wrapMode="none"
                                                />
                                            }
                                        >
                                            <box
                                                width={
                                                    emptyDescriptionPrefix.length
                                                }
                                                flexShrink={0}
                                            >
                                                <text
                                                    fg={colors().success}
                                                    content={
                                                        emptyDescriptionPrefix
                                                    }
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
                                    }
                                >
                                    <text
                                        fg={colors().text}
                                        content={props.annotation}
                                        wrapMode="none"
                                    />
                                </Show>
                            </box>
                        </Show>
                    </>
                }
            >
                <box flexDirection="row" flexGrow={1} overflow="hidden">
                    <box width={1} flexShrink={0} overflow="hidden">
                        <text fg={colors().textMuted} wrapMode="none">
                            {" "}
                        </text>
                    </box>
                    <box flexGrow={1} overflow="hidden">
                        <AnsiText
                            content={scrollableContent()}
                            defaultFg={contentFg()}
                            wrapMode="none"
                            cropStart={props.horizontalScroll?.cropStart ?? 0}
                            cropWidth={props.horizontalScroll?.cropWidth ?? 1}
                        />
                    </box>
                </box>
            </Show>
        </box>
    )
}
