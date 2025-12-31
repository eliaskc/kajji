import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createSignal } from "solid-js"
import { useCommand } from "../../context/command"
import { useFocus } from "../../context/focus"
import { useSync } from "../../context/sync"
import { colors } from "../../theme"
import { AnsiText } from "../AnsiText"

export function LogPanel() {
	const {
		commits,
		selectedIndex,
		loading,
		error,
		selectNext,
		selectPrev,
		selectFirst,
		selectLast,
		enterFilesView,
		viewMode,
	} = useSync()
	const focus = useFocus()
	const command = useCommand()

	const isFocused = () => focus.is("log")
	const title = () => (viewMode() === "files" ? "[1] Files" : "[1] Log")

	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)

	createEffect(() => {
		const index = selectedIndex()
		const commitList = commits()
		if (!scrollRef || commitList.length === 0) return

		let lineOffset = 0
		const clampedIndex = Math.min(index, commitList.length)
		for (const commit of commitList.slice(0, clampedIndex)) {
			lineOffset += commit.lines.length
		}

		const margin = 2
		const refAny = scrollRef as unknown as Record<string, unknown>
		const viewportHeight =
			(typeof refAny.height === "number" ? refAny.height : null) ??
			(typeof refAny.rows === "number" ? refAny.rows : null) ??
			10
		const currentScrollTop = scrollTop()

		const visibleStart = currentScrollTop
		const visibleEnd = currentScrollTop + viewportHeight - 1
		const safeStart = visibleStart + margin
		const safeEnd = visibleEnd - margin

		let newScrollTop = currentScrollTop
		if (lineOffset < safeStart) {
			newScrollTop = Math.max(0, lineOffset - margin)
		} else if (lineOffset > safeEnd) {
			newScrollTop = Math.max(0, lineOffset - viewportHeight + margin + 1)
		}

		if (newScrollTop !== currentScrollTop) {
			scrollRef.scrollTo(newScrollTop)
			setScrollTop(newScrollTop)
		}
	})

	command.register(() => [
		{
			id: "log.next",
			title: "Next commit",
			keybind: "nav_down",
			context: "log",
			category: "Navigation",
			onSelect: selectNext,
		},
		{
			id: "log.prev",
			title: "Previous commit",
			keybind: "nav_up",
			context: "log",
			category: "Navigation",
			onSelect: selectPrev,
		},
		{
			id: "log.first",
			title: "First commit",
			keybind: "nav_first",
			context: "log",
			category: "Navigation",
			onSelect: selectFirst,
		},
		{
			id: "log.last",
			title: "Last commit",
			keybind: "nav_last",
			context: "log",
			category: "Navigation",
			onSelect: selectLast,
		},
		{
			id: "log.enter_files",
			title: "View files",
			keybind: "enter",
			context: "log",
			category: "Navigation",
			onSelect: () => enterFilesView(),
		},
	])

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			height="100%"
			border
			borderColor={isFocused() ? colors.borderFocused : colors.border}
			overflow="hidden"
			gap={0}
		>
			<box backgroundColor={colors.backgroundSecondary}>
				<text fg={isFocused() ? colors.primary : colors.textMuted}>
					{title()}
				</text>
			</box>
			<Show when={loading()}>
				<text>Loading...</text>
			</Show>
			<Show when={error()}>
				<text>Error: {error()}</text>
			</Show>
			<Show when={!loading() && !error()}>
				<scrollbox
					ref={scrollRef}
					flexGrow={1}
					scrollbarOptions={{ visible: false }}
				>
					<For each={commits()}>
						{(commit, index) => {
							const isSelected = () => index() === selectedIndex()
							return (
								<For each={commit.lines}>
									{(line) => (
										<box
											backgroundColor={
												isSelected() ? colors.selectionBackground : undefined
											}
											overflow="hidden"
										>
											<AnsiText
												content={line}
												bold={commit.isWorkingCopy}
												wrapMode="none"
											/>
										</box>
									)}
								</For>
							)
						}}
					</For>
				</scrollbox>
			</Show>
		</box>
	)
}
