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
                                hideRevisionId
                            />
                        </box>
                    )}
                </For>
            </box>

            <Show when={hasEffects()}>
                <box flexDirection="column">
                    <Show when={props.plan.updatePrNumbers.length > 0}>
                        <text wrapMode="none" fg={colors().text}>
                            {`Would update PRs: ${props.plan.updatePrNumbers
                                .map((number) => `#${number}`)
                                .join(", ")}`}
                        </text>
                    </Show>
                    <Show when={props.plan.createPrBookmarks.length > 0}>
                        <text wrapMode="none" fg={colors().text}>
                            {`Would create PRs: ${props.plan.createPrBookmarks.join(", ")}`}
                        </text>
                    </Show>
                    <Show when={props.plan.pushBookmarks.length > 0}>
                        <text wrapMode="none" fg={colors().text}>
                            {`Would push: ${props.plan.pushBookmarks.join(", ")}`}
                        </text>
                    </Show>
                    <Show when={props.plan.rebaseBookmarks.length > 0}>
                        <text wrapMode="none" fg={colors().text}>
                            {`Would rebase: ${props.plan.rebaseBookmarks.join(", ")}`}
                        </text>
                    </Show>
                    <Show when={props.plan.abandonBookmarks.length > 0}>
                        <text wrapMode="none" fg={colors().text}>
                            {`Would abandon: ${props.plan.abandonBookmarks.join(", ")}`}
                        </text>
                    </Show>
                    <Show when={props.plan.closePrNumbers.length > 0}>
                        <text wrapMode="none" fg={colors().text}>
                            {`Would close PRs: ${props.plan.closePrNumbers
                                .map((number) => `#${number}`)
                                .join(", ")}`}
                        </text>
                    </Show>
                </box>
            </Show>
        </box>
    )
}
