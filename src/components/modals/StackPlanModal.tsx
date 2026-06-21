import { useKeyboard } from "@opentui/solid"
import { For, Show } from "solid-js"
import type { Bookmark } from "../../commander/bookmarks"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import type { StackPlan } from "../../stack/model"
import { BookmarkStackRowView } from "../BookmarkStackRowView"

interface StackPlanModalProps {
    plan: StackPlan<Bookmark>
    onApply: () => void
    onBack: () => void
}

export function StackPlanModal(props: StackPlanModalProps) {
    const dialog = useDialog()
    const { colors } = useTheme()
    const hasEffects = () => props.plan.effects.length > 0
    const actionLines = () => stackActionLines(props.plan)
    let applying = false

    const apply = () => {
        if (!hasEffects() || applying) return
        applying = true
        dialog.close()
        props.onApply()
    }

    useKeyboard((evt) => {
        if (evt.name === "escape") {
            evt.preventDefault()
            evt.stopPropagation()
            dialog.close()
            props.onBack()
            return
        }

        if (evt.name === "return" || evt.name === "enter") {
            evt.preventDefault()
            evt.stopPropagation()
            apply()
        }
    })

    return (
        <box flexDirection="column" gap={1} minHeight={10}>
            <box flexDirection="column">
                <Show when={!hasEffects()}>
                    <box flexDirection="column" gap={1} paddingLeft={1}>
                        <text wrapMode="none" fg={colors().success}>
                            Nothing to do
                        </text>
                        <text wrapMode="none" fg={colors().textMuted}>
                            This stack is already in sync with GitHub.
                        </text>
                    </box>
                </Show>
                <For each={props.plan.rows}>
                    {(row) => (
                        <box flexDirection="row" overflow="hidden">
                            <BookmarkStackRowView
                                row={row.row}
                                prNumber={row.prNumber}
                                annotation={row.note}
                                hideDescription
                            />
                        </box>
                    )}
                </For>
            </box>

            <Show when={hasEffects()}>
                <box flexDirection="column">
                    <For each={actionLines()}>
                        {(line) => (
                            <text wrapMode="none" fg={colors().text}>
                                <span style={{ fg: colors().textMuted }}>
                                    →{" "}
                                </span>
                                <For each={line}>
                                    {(segment) => (
                                        <span
                                            style={{
                                                fg:
                                                    segment.kind === "action"
                                                        ? colors().warning
                                                        : segment.kind ===
                                                            "identifier"
                                                          ? colors().primary
                                                          : colors().text,
                                            }}
                                        >
                                            {segment.text}
                                        </span>
                                    )}
                                </For>
                            </text>
                        )}
                    </For>
                </box>
            </Show>
        </box>
    )
}

type ActionLineSegment = {
    readonly text: string
    readonly kind?: "action" | "identifier"
}

function stackActionLines(
    plan: StackPlan<Bookmark>,
): readonly ActionLineSegment[][] {
    const lines: ActionLineSegment[][] = []
    const effects = plan.effects
    const pushBookmarks = unique(
        effects
            .filter((effect) => effect.type === "push")
            .map((effect) => effect.bookmark),
    )

    for (const effect of effects) {
        if (effect.type === "abandon") {
            lines.push([
                action("abandon"),
                text(" merged local change "),
                identifier(effect.bookmark),
            ])
        }
        if (effect.type === "abandon-landed-range") {
            lines.push([
                action("abandon"),
                text(" landed parent range from "),
                identifier(effect.bookmark),
            ])
        }
    }

    if (pushBookmarks.length > 0) {
        lines.push([action("push"), text(" "), identifiers(pushBookmarks)])
    }

    for (const effect of effects) {
        if (effect.type === "create-pr") {
            lines.push([
                action("create PR"),
                text(" for "),
                identifier(effect.bookmark),
                text(" onto "),
                identifier(effect.to ?? plan.stackRootName),
            ])
        }
    }

    for (const effect of effects) {
        if (effect.type === "rebase") {
            lines.push(
                effect.from
                    ? [
                          action("rebase"),
                          text(" "),
                          identifier(effect.bookmark),
                          text(" from "),
                          identifier(effect.from),
                          text(" onto "),
                          identifier(effect.to ?? "target"),
                      ]
                    : [
                          action("rebase"),
                          text(" "),
                          identifier(effect.bookmark),
                          text(" onto "),
                          identifier(effect.to ?? "target"),
                      ],
            )
        }
    }

    for (const effect of effects) {
        if (effect.type === "update-pr" && effect.prNumber) {
            lines.push(
                effect.from
                    ? [
                          action("retarget"),
                          text(" "),
                          identifier(`#${effect.prNumber}`),
                          text(" ("),
                          identifier(effect.bookmark),
                          text(") from "),
                          identifier(effect.from),
                          text(" to "),
                          identifier(effect.to ?? "target"),
                      ]
                    : [
                          action("retarget"),
                          text(" "),
                          identifier(`#${effect.prNumber}`),
                          text(" ("),
                          identifier(effect.bookmark),
                          text(") to "),
                          identifier(effect.to ?? "target"),
                      ],
            )
        }
    }

    for (const effect of effects) {
        if (effect.type === "close-pr" && effect.prNumber) {
            lines.push([
                action("close"),
                text(" "),
                identifier(`#${effect.prNumber}`),
                text(" ("),
                identifier(effect.bookmark),
                text(effect.reason ? `): ${effect.reason}` : ")"),
            ])
        }
        if (effect.type === "blocked") {
            lines.push([
                action("blocked"),
                text(" "),
                identifier(effect.bookmark),
                text(effect.reason ? `: ${effect.reason}` : ""),
            ])
        }
    }

    const commentPrNumbers = unique(
        effects
            .filter(
                (effect) => effect.type === "update-comment" && effect.prNumber,
            )
            .map((effect) => effect.prNumber ?? 0),
    )
    if (commentPrNumbers.length === 1) {
        lines.push([
            action("update"),
            text(" "),
            identifier(`#${commentPrNumbers[0]}`),
            text(" stack block"),
        ])
    } else if (commentPrNumbers.length > 1) {
        lines.push([
            action("update"),
            text(" stack blocks for "),
            identifiers(commentPrNumbers.map((number) => `#${number}`)),
        ])
    }

    return lines
}

function action(textValue: string): ActionLineSegment {
    return { text: textValue, kind: "action" }
}

function identifier(textValue: string): ActionLineSegment {
    return { text: textValue, kind: "identifier" }
}

function identifiers(values: readonly string[]): ActionLineSegment {
    return identifier(values.join(", "))
}

function text(textValue: string): ActionLineSegment {
    return { text: textValue }
}

function unique<T>(items: readonly T[]): readonly T[] {
    return [...new Set(items)]
}
