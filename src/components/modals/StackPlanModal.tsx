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

    for (const effect of plan.effects) {
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
        if (effect.type === "push") {
            lines.push([action("push"), text(" "), identifier(effect.bookmark)])
        }
        if (effect.type === "create-pr") {
            lines.push([
                action("create PR"),
                text(" for "),
                identifier(effect.bookmark),
                text(" onto "),
                identifier(effect.to ?? plan.stackRootName),
            ])
        }
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
        if (effect.type === "update-comment" && effect.prNumber) {
            lines.push([
                action("update"),
                text(" "),
                identifier(`#${effect.prNumber}`),
                text(" stack block"),
            ])
        }
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
