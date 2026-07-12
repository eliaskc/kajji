import type { Commit } from "../commander/types"
import type { CommitDetails } from "../context/sync"
import { useTheme } from "../context/theme"
import { AnsiText } from "./AnsiText"

export function stripEmailAndDate(
    refLine: string,
    email: string,
    timestamp: string,
): string {
    let result = refLine
    const escapeRegex = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const ansiWrap = (value: string) =>
        `(?:\\x1b\\[[0-9;]*m)*${value}(?:\\x1b\\[[0-9;]*m)*\\s*`

    if (email) {
        result = result.replace(
            new RegExp(ansiWrap(escapeRegex(email)), "g"),
            "",
        )
    }

    if (timestamp) {
        const [date, time] = timestamp.split(" ")
        if (date) {
            result = result.replace(
                new RegExp(ansiWrap(escapeRegex(date)), "g"),
                "",
            )
        }
        if (time) {
            result = result.replace(
                new RegExp(ansiWrap(escapeRegex(time)), "g"),
                "",
            )
        }
    }

    return result
}

export function BookmarkDiffHeader(props: {
    bookmark: string
    from: string
    to: string
}) {
    const { colors } = useTheme()
    return (
        <box flexDirection="column" flexShrink={0}>
            <text>
                <span style={{ fg: colors().textMuted }}>{"Diff: "}</span>
                <span style={{ fg: colors().primary }}>{props.from}</span>
                <span style={{ fg: colors().textMuted }}>{" → "}</span>
                <span style={{ fg: colors().primary }}>{props.to}</span>
            </text>
            <text fg={colors().textMuted}>
                local vs origin for {props.bookmark}
            </text>
        </box>
    )
}

export function MinimalCommitHeader(props: {
    commit: Commit
    details: CommitDetails | null
}) {
    const subject = () => props.details?.subject || props.commit.description
    const cleanRefLine = () =>
        stripEmailAndDate(
            props.commit.refLine,
            props.commit.authorEmail,
            props.commit.timestamp,
        )

    return (
        <box flexDirection="column" flexShrink={0}>
            <AnsiText content={cleanRefLine()} wrapMode="none" />
            <box flexDirection="row">
                <text>{"    "}</text>
                <AnsiText content={subject()} wrapMode="none" />
            </box>
        </box>
    )
}
