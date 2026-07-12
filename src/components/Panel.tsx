import { For, type JSX, Show } from "solid-js"
import { useCommand } from "../context/command"
import { useFocus } from "../context/focus"
import { useTheme } from "../context/theme"
import type { Context, Panel as PanelType } from "../context/types"

interface Tab {
    id: string
    label: string
    context: Context
}

type CornerContent = JSX.Element | string | (() => JSX.Element | string)

interface PanelProps {
    title?: string
    tabs?: Tab[]
    activeTab?: string
    onTabChange?: (tabId: string) => void
    panelId?: PanelType
    hotkey: string
    focused: boolean
    topRight?: CornerContent
    overflow?: "hidden" | "visible"
    children: JSX.Element
}

export function Panel(props: PanelProps) {
    const { colors } = useTheme()
    const command = useCommand()
    const focus = useFocus()

    const hasTabs = () => props.tabs && props.tabs.length > 1

    const cycleTab = (direction: 1 | -1) => {
        if (!props.tabs || props.tabs.length <= 1 || !props.onTabChange) return
        const currentIndex = props.tabs.findIndex(
            (t) => t.id === props.activeTab,
        )
        const nextIndex =
            (currentIndex + direction + props.tabs.length) % props.tabs.length
        const nextTab = props.tabs[nextIndex]
        if (nextTab) props.onTabChange(nextTab.id)
    }

    command.register(() => {
        if (!hasTabs() || !props.panelId) return []

        return [
            {
                id: `${props.panelId}.next_tab`,
                title: "next tab",
                keybind: "next_tab",
                context: props.panelId,
                group: "navigation" as const,
                panel: props.panelId,
                visibleIn: ["palette"] as const,
                execute: () => cycleTab(1),
            },
            {
                id: `${props.panelId}.prev_tab`,
                title: "previous tab",
                keybind: "prev_tab",
                context: props.panelId,
                group: "navigation" as const,
                panel: props.panelId,
                visibleIn: ["palette"] as const,
                execute: () => cycleTab(-1),
            },
        ]
    })

    const resolveCorner = (content: CornerContent | undefined) =>
        typeof content === "function" ? content() : content

    const renderTitle = () => {
        const titleBg = () =>
            props.focused ? colors().titleBarFocused : undefined
        const titleColor = () =>
            props.focused ? colors().titleTextFocused : colors().textMuted

        if (hasTabs()) {
            return (
                <box
                    flexDirection="row"
                    height={1}
                    flexShrink={0}
                    backgroundColor={titleBg()}
                >
                    <text>
                        <span style={{ fg: titleColor() }}>
                            {props.hotkey}{" "}
                        </span>
                        <For each={props.tabs}>
                            {(tab, i) => (
                                <>
                                    <Show when={i() > 0}>
                                        <span
                                            style={{ fg: colors().textMuted }}
                                        >
                                            {" "}
                                        </span>
                                    </Show>
                                    <span
                                        style={{
                                            fg:
                                                tab.id === props.activeTab
                                                    ? titleColor()
                                                    : props.focused
                                                      ? colors().titleTextMuted
                                                      : colors().textMuted,
                                            bold: tab.id === props.activeTab,
                                        }}
                                    >
                                        {tab.label}
                                    </span>
                                </>
                            )}
                        </For>
                    </text>
                    <box flexGrow={1} />
                    <Show when={props.topRight}>
                        {resolveCorner(props.topRight)}
                    </Show>
                </box>
            )
        }

        return (
            <box
                flexDirection="row"
                height={1}
                flexShrink={0}
                backgroundColor={titleBg()}
            >
                <text fg={titleColor()}>
                    {props.hotkey} {props.title}
                </text>
                <box flexGrow={1} />
                <Show when={props.topRight}>
                    {resolveCorner(props.topRight)}
                </Show>
            </box>
        )
    }

    const handleMouseDown = () => {
        if (props.panelId) {
            focus.setPanel(props.panelId)
        }
    }

    return (
        <box
            flexGrow={1}
            flexDirection="column"
            height="100%"
            backgroundColor={colors().background}
            overflow={props.overflow ?? "hidden"}
            gap={0}
            onMouseDown={handleMouseDown}
        >
            {renderTitle()}
            {props.children}
        </box>
    )
}
