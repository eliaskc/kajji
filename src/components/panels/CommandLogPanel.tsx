import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { useFocus } from "../../context/focus"
import { useTheme } from "../../context/theme"
import { blendColors } from "../../utils/color"
import { Panel } from "../Panel"

export function CommandLogPanel() {
	const { colors } = useTheme()
	const commandLog = useCommandLog()
	const focus = useFocus()
	const command = useCommand()

	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)

	const isFocused = () => focus.isPanel("commandlog")
	const [animationTick, setAnimationTick] = createSignal(0)
	const spinnerTimer = setInterval(() => {
		if (
			commandLog
				.entries()
				.some(
					(entry) =>
						entry.status === "running" ||
						(entry.status === "success" && entry.completedAt),
				)
		) {
			setAnimationTick((index) => index + 1)
		}
	}, 80)
	onCleanup(() => clearInterval(spinnerTimer))

	const entryPrefix = (
		entry: ReturnType<typeof commandLog.entries>[number],
	) => {
		if (entry.status === "failure") return "x "
		if (entry.status === "skipped" || entry.status === "info") return "- "
		return ""
	}

	const entryColor = (entry: ReturnType<typeof commandLog.entries>[number]) => {
		if (entry.status === "failure") return colors().error
		if (entry.status === "success") return successColor(entry)
		if (entry.status === "skipped" || entry.status === "info")
			return colors().textMuted
		return colors().textMuted
	}

	const entryText = (entry: ReturnType<typeof commandLog.entries>[number]) => {
		const prefix = entryPrefix(entry)
		const body = entry.command ? `$ ${entry.command}` : (entry.message ?? "")
		const suffix =
			entry.command && entry.status === "failure"
				? `  [exit ${entry.exitCode ?? 1}]`
				: ""
		return `${prefix}${body}${suffix}`
	}

	const commandAgeMs = (
		entry: ReturnType<typeof commandLog.entries>[number],
	) => {
		animationTick()
		return Date.now() - entry.timestamp.getTime()
	}

	const completionAgeMs = (
		entry: ReturnType<typeof commandLog.entries>[number],
	) => {
		animationTick()
		return entry.completedAt ? Date.now() - entry.completedAt.getTime() : null
	}

	const waveColor = (
		entry: ReturnType<typeof commandLog.entries>[number],
		index: number,
		length: number,
	) => {
		const phase = Math.floor(commandAgeMs(entry) / 80) % Math.max(length, 1)
		const distance = Math.abs(index - phase)
		const wrappedDistance = Math.min(distance, length - distance)
		const opacity = Math.max(0.15, 1 - wrappedDistance * 0.28)
		return blendColors(colors().statusBarKey, colors().textMuted, opacity)
	}

	const successColor = (
		entry: ReturnType<typeof commandLog.entries>[number],
	) => {
		const age = completionAgeMs(entry)
		if (age === null) return colors().textMuted
		if (age < 1500) return colors().statusBarKey
		const fadeProgress = Math.min(1, (age - 1500) / 300)
		const easedProgress = 1 - (1 - fadeProgress) ** 3
		return blendColors(
			colors().statusBarKey,
			colors().textMuted,
			1 - easedProgress,
		)
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

	return (
		<box height={isFocused() ? 24 : 10} overflow="hidden">
			<Panel
				title="Command log"
				hotkey="4"
				focused={isFocused()}
				panelId="commandlog"
			>
				<scrollbox
					ref={scrollRef}
					flexGrow={1}
					focused={isFocused()}
					stickyScroll={!isFocused()}
					stickyStart="bottom"
					verticalScrollbarOptions={{
						trackOptions: {
							backgroundColor: colors().scrollbarTrack,
							foregroundColor: colors().scrollbarThumb,
						},
					}}
				>
					<box flexDirection="column">
						<Show
							when={commandLog.entries().length > 0}
							fallback={
								<text fg={colors().textMuted}>No commands executed yet</text>
							}
						>
							<For each={commandLog.entries()}>
								{(entry) => {
									const text = () => entryText(entry)
									const chars = () => [...text()]
									return (
										<box flexDirection="column">
											<text fg={entryColor(entry)}>
												<Show
													when={entry.status === "running"}
													fallback={text()}
												>
													<For each={chars()}>
														{(char, index) => (
															<span
																style={{
																	fg: waveColor(entry, index(), chars().length),
																}}
															>
																{char}
															</span>
														)}
													</For>
												</Show>
											</text>
											<Show when={entry.output.length > 0}>
												<text fg={colors().text}>{entry.output}</text>
											</Show>
										</box>
									)
								}}
							</For>
						</Show>
					</box>
				</scrollbox>
			</Panel>
		</box>
	)
}
