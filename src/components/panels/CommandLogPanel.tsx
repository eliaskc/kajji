import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createSignal } from "solid-js"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useFocus } from "../../context/focus"
import { useTheme } from "../../context/theme"
import { BorderBox } from "../BorderBox"

export function CommandLogPanel() {
	const { colors, style } = useTheme()
	const commandLog = useCommandLog()
	const focus = useFocus()
	const command = useCommand()

	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)

	const isFocused = () => focus.isPanel("commandlog")

	const handleMouseDown = () => {
		focus.setPanel("commandlog")
	}

	command.register(() => [
		{
			id: "commandlog.scroll_down",
			title: "scroll down",
			keybind: "nav_down",
			context: "commandlog",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				scrollRef?.scrollTo((scrollTop() || 0) + 1)
				setScrollTop((scrollTop() || 0) + 1)
			},
		},
		{
			id: "commandlog.scroll_up",
			title: "scroll up",
			keybind: "nav_up",
			context: "commandlog",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => {
				const newPos = Math.max(0, (scrollTop() || 0) - 1)
				scrollRef?.scrollTo(newPos)
				setScrollTop(newPos)
			},
		},
		{
			id: "commandlog.page_down",
			title: "page down",
			keybind: "nav_page_down",
			context: "commandlog",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => scrollRef?.scrollBy(0.5, "viewport"),
		},
		{
			id: "commandlog.page_up",
			title: "page up",
			keybind: "nav_page_up",
			context: "commandlog",
			type: "navigation",
			visibility: "help-only",
			onSelect: () => scrollRef?.scrollBy(-0.5, "viewport"),
		},
	])

	const renderTitle = () => (
		<text>
			<Show
				when={isFocused()}
				fallback={<span style={{ fg: colors().border }}>[4]─Command log</span>}
			>
				<span style={{ fg: colors().borderFocused }}>[4]─Command log</span>
			</Show>
		</text>
	)

	return (
		<BorderBox
			topLeft={renderTitle}
			border
			borderStyle={style().panel.borderStyle}
			borderColor={isFocused() ? colors().borderFocused : colors().border}
			height={isFocused() ? 15 : 6}
			overflow="hidden"
			onMouseDown={handleMouseDown}
		>
			<scrollbox
				ref={scrollRef}
				flexGrow={1}
				focused={isFocused()}
				stickyScroll={!isFocused()}
				stickyStart="bottom"
			>
				<Show
					when={commandLog.entries().length > 0}
					fallback={
						<text fg={colors().textMuted}>No commands executed yet</text>
					}
				>
					<For each={commandLog.entries()}>
						{(entry) => (
							<box flexDirection="column">
								<text fg={colors().textMuted}>$ {entry.command}</text>
								<text fg={entry.success ? colors().success : colors().error}>
									{entry.output}
								</text>
							</box>
						)}
					</For>
				</Show>
			</scrollbox>
		</BorderBox>
	)
}
