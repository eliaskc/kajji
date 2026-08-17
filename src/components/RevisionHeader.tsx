import { Show, createMemo } from "solid-js"
import type { Commit } from "../commander/types"
import { useTheme } from "../context/theme"
import type { DiffStats } from "../diff/types"

/** Strip the author email from a jj-rendered ref line. */
export function stripEmail(refLine: string, email: string): string {
    if (!email) return refLine
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return refLine.replace(
        new RegExp(`(?:\\x1b\\[[0-9;]*m)*${escaped}(?:\\x1b\\[[0-9;]*m)*\\s*`, "g"),
        "",
    )
}

export function BookmarkDiffHeader(props: { bookmark: string; from: string; to: string }) {
    const { colors } = useTheme()
    return (
        <box flexDirection="column" flexShrink={0}>
            <text>
                <span style={{ fg: colors().textMuted }}>{"Diff: "}</span>
                <span style={{ fg: colors().primary }}>{props.from}</span>
                <span style={{ fg: colors().textMuted }}>{" → "}</span>
                <span style={{ fg: colors().primary }}>{props.to}</span>
            </text>
            <text fg={colors().textMuted}>local vs origin for {props.bookmark}</text>
        </box>
    )
}

export function DiffStatsSummary(props: { stats: DiffStats }) {
    const { colors } = useTheme()
    const s = () => props.stats
    return (
        <text>
            <span style={{ fg: colors().text }}>
                {s().totalFiles} file{s().totalFiles !== 1 ? "s" : ""} changed
            </span>
            <Show when={s().totalInsertions > 0}>
                <span style={{ fg: colors().text }}>{", "}</span>
                <span style={{ fg: colors().success }}>
                    {s().totalInsertions} insertion
                    {s().totalInsertions !== 1 ? "s" : ""}(+)
                </span>
            </Show>
            <Show when={s().totalDeletions > 0}>
                <span style={{ fg: colors().text }}>{", "}</span>
                <span style={{ fg: colors().error }}>
                    {s().totalDeletions} deletion
                    {s().totalDeletions !== 1 ? "s" : ""}(-)
                </span>
            </Show>
        </text>
    )
}

/** Detail header for a multi-revision selection. */
export function RevisionRangeHeader(props: {
    /** Marked revisions visible in the loaded log, newest first. */
    commits: Commit[]
    /** Selected revisions hidden behind elided log sections. */
    elidedCount: number
    stats: DiffStats | null
    maxWidth: number
}) {
    const { colors } = useTheme()
    const newest = () => props.commits[0]
    const oldest = () => props.commits[props.commits.length - 1]
    const totalCount = () => props.commits.length + props.elidedCount

    const authors = createMemo(() => {
        const unique = new Map<string, string>()
        for (const commit of props.commits) {
            const key = commit.authorEmail || commit.author
            if (!unique.has(key)) {
                unique.set(
                    key,
                    commit.authorEmail ? `${commit.author} <${commit.authorEmail}>` : commit.author,
                )
            }
        }
        const values = [...unique.values()]
        const visible = values.slice(0, 3)
        const overflow = values.length - visible.length
        return {
            label: values.length === 1 ? "Author:    " : "Authors:   ",
            text: `${visible.join(", ")}${overflow > 0 ? ` +${overflow}` : ""}`,
        }
    })

    const committed = () => {
        const from = oldest()
        const to = newest()
        if (!from || !to) return ""
        const fromTime = from.committerTimestamp ?? from.timestamp
        const toTime = to.committerTimestamp ?? to.timestamp
        return `${fromTime} — ${toTime}`
    }

    return (
        <box flexDirection="column" flexShrink={0}>
            <text>
                <span style={{ fg: colors().secondary }}>{`${totalCount()} revisions`}</span>
                <Show when={props.elidedCount > 0}>
                    <span style={{ fg: colors().textMuted }}>
                        {` (${props.elidedCount} elided)`}
                    </span>
                </Show>
                <span style={{ fg: colors().textMuted }}>
                    {`  ${oldest()?.changeId.slice(0, 8) ?? ""}..${newest()?.changeId.slice(0, 8) ?? ""}`}
                </span>
            </text>
            <text>
                <span style={{ fg: colors().textMuted }}>{authors().label}</span>
                <span style={{ fg: colors().secondary }}>{authors().text}</span>
            </text>
            <text>
                <span style={{ fg: colors().textMuted }}>{"Committed: "}</span>
                <span style={{ fg: colors().secondary }}>{committed()}</span>
            </text>
            <Show when={props.stats && props.stats.totalFiles > 0 ? props.stats : undefined}>
                {(stats: () => DiffStats) => (
                    <box flexDirection="column">
                        <text> </text>
                        <DiffStatsSummary stats={stats()} />
                        <text fg={colors().textMuted}>{"─".repeat(props.maxWidth + 2)}</text>
                    </box>
                )}
            </Show>
        </box>
    )
}
