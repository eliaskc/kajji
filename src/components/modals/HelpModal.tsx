import { type InputRenderable, RGBA } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import {
	type Accessor,
	For,
	Show,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js"
import {
	type CommandContext,
	type CommandOption,
	useCommand,
} from "../../context/command"
import { useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import type { KeybindConfigKey } from "../../keybind"

type PanelGroup = "log" | "bookmarks" | "diff" | "global"

interface PanelGroupData {
	panel: PanelGroup
	label: string
	commands: CommandOption[]
}

const PANEL_ORDER: PanelGroup[] = ["log", "bookmarks", "diff", "global"]

const PANEL_LABELS: Record<PanelGroup, string> = {
	log: "Log",
	bookmarks: "Bookmarks",
	diff: "Diff",
	global: "Global",
}

function contextToPanel(context: CommandContext): PanelGroup {
	switch (context) {
		case "commits":
		case "files":
			return "log"
		case "bookmarks":
			return "bookmarks"
		case "diff":
			return "diff"
		case "global":
		case "help":
			return "global"
	}
}

const NARROW_THRESHOLD = 100

export function HelpModal() {
	const renderer = useRenderer()
	const command = useCommand()
	const keybind = useKeybind()
	const dialog = useDialog()
	const focus = useFocus()
	const { colors, style } = useTheme()
	const [filter, setFilter] = createSignal("")
	const [selectedIndex, setSelectedIndex] = createSignal(-1)
	const [terminalWidth, setTerminalWidth] = createSignal(renderer.width)

	onMount(() => {
		const handleResize = (width: number) => setTerminalWidth(width)
		renderer.on("resize", handleResize)
		onCleanup(() => renderer.off("resize", handleResize))
	})

	const columnCount = () => (terminalWidth() < NARROW_THRESHOLD ? 1 : 3)

	type SearchableCommand = CommandOption & { keybindStr: string }

	const allCommands = createMemo((): SearchableCommand[] => {
		return command
			.all()
			.filter((cmd) => !cmd.hidden)
			.map((cmd) => ({
				...cmd,
				keybindStr: cmd.keybind ? keybind.print(cmd.keybind) : "",
			}))
	})

	const matchedCommands = createMemo(() => {
		const all = allCommands()
		const filterText = filter().trim()

		if (!filterText) {
			return all
		}

		const results = fuzzysort.go(filterText, all, {
			keys: ["title", "context", "keybindStr"],
			threshold: -10000,
		})

		return results.map((r) => r.obj)
	})

	const matchedIds = createMemo(() => {
		return new Set(matchedCommands().map((cmd) => cmd.id))
	})

	createEffect(() => {
		const filterText = filter().trim()
		if (filterText) {
			setSelectedIndex(0)
		} else {
			setSelectedIndex(-1)
		}
	})

	const selectedCommand = createMemo(() => {
		const idx = selectedIndex()
		if (idx < 0) return null
		return matchedInColumnOrder()[idx] ?? null
	})

	const groupedCommands = createMemo((): PanelGroupData[] => {
		const all = allCommands()

		const groups = new Map<PanelGroup, CommandOption[]>()
		for (const cmd of all) {
			const panel = cmd.panel ?? contextToPanel(cmd.context)
			const existing = groups.get(panel) || []
			groups.set(panel, [...existing, cmd])
		}

		const result: PanelGroupData[] = []
		for (const panel of PANEL_ORDER) {
			const commands = groups.get(panel)
			if (commands && commands.length > 0) {
				result.push({ panel, label: PANEL_LABELS[panel], commands })
			}
		}

		return result
	})

	const columns = createMemo(() => {
		const groups = groupedCommands()
		const numCols = columnCount()
		const cols: PanelGroupData[][] = Array.from({ length: numCols }, () => [])

		let colIndex = 0
		for (const group of groups) {
			const col = cols[colIndex]
			if (col) col.push(group)
			colIndex = (colIndex + 1) % numCols
		}

		return cols
	})

	const commandsInColumnOrder = createMemo(() => {
		const cols = columns()
		const result: CommandOption[] = []
		for (const column of cols) {
			for (const group of column) {
				for (const cmd of group.commands) {
					result.push(cmd)
				}
			}
		}
		return result
	})

	const matchedInColumnOrder = createMemo(() => {
		const matched = matchedIds()
		return commandsInColumnOrder().filter((cmd) => matched.has(cmd.id))
	})

	const move = (direction: 1 | -1) => {
		const matched = matchedInColumnOrder()
		if (matched.length === 0) return

		setSelectedIndex((prev) => {
			if (prev < 0) return 0
			let next = prev + direction
			if (next < 0) next = matched.length - 1
			if (next >= matched.length) next = 0
			return next
		})
	}

	const executeSelected = () => {
		const cmd = selectedCommand()
		if (cmd) {
			dialog.close()
			cmd.onSelect()
		}
	}

	useKeyboard((evt) => {
		if (evt.name === "j" || evt.name === "down") {
			evt.preventDefault()
			move(1)
		} else if (evt.name === "k" || evt.name === "up") {
			evt.preventDefault()
			move(-1)
		} else if (evt.name === "return") {
			evt.preventDefault()
			executeSelected()
		}
	})

	const separator = () => style().statusBar.separator
	const gap = () => (separator() ? 0 : 3)

	const isMatched = (cmd: CommandOption) => matchedIds().has(cmd.id)
	const isSelected = (cmd: CommandOption) => selectedCommand()?.id === cmd.id
	const isActive = (cmd: CommandOption) => {
		if (cmd.context === "global") return true
		if (cmd.context !== focus.activeContext()) return false
		if (cmd.panel && cmd.panel !== focus.panel()) return false
		return true
	}

	return (
		<box
			flexDirection="column"
			border
			borderStyle={style().panel.borderStyle}
			borderColor={colors().borderFocused}
			backgroundColor={colors().background}
			padding={1}
			width="80%"
			height="80%"
			title="[esc / ?]─Commands"
		>
			<box flexDirection="row" marginBottom={2} paddingLeft={4}>
				<input
					ref={(r: InputRenderable) => setTimeout(() => r.focus(), 1)}
					onInput={(value) => setFilter(value)}
					onSubmit={() => executeSelected()}
					placeholder="Search"
					flexGrow={1}
					cursorColor={colors().primary}
					textColor={colors().textMuted}
					focusedTextColor={colors().text}
					focusedBackgroundColor={RGBA.fromInts(0, 0, 0, 0)}
				/>
			</box>

			<box flexDirection="row" flexGrow={1} gap={1}>
				<For each={columns()}>
					{(column) => (
						<box flexDirection="column" flexGrow={1} flexBasis={0}>
							<For each={column}>
								{(group) => (
									<box flexDirection="column" marginBottom={1}>
										<box flexDirection="row">
											<box width={10} flexShrink={0} />
											<text fg={colors().primary}> {group.label}</text>
										</box>
										<For each={group.commands}>
											{(cmd) => (
												<box
													flexDirection="row"
													backgroundColor={
														isSelected(cmd)
															? colors().selectionBackground
															: undefined
													}
												>
													<box width={10} flexShrink={0}>
														<Show when={cmd.keybind}>
															{(kb: Accessor<KeybindConfigKey>) => (
																<text
																	fg={
																		isSelected(cmd)
																			? colors().selectionText
																			: isMatched(cmd) && isActive(cmd)
																				? colors().info
																				: colors().textMuted
																	}
																	wrapMode="none"
																>
																	{keybind.print(kb()).padStart(9)}
																</text>
															)}
														</Show>
													</box>
													<text
														fg={
															isSelected(cmd)
																? colors().selectionText
																: isMatched(cmd) && isActive(cmd)
																	? colors().text
																	: colors().textMuted
														}
													>
														{" "}
														{cmd.title}
													</text>
												</box>
											)}
										</For>
									</box>
								)}
							</For>
						</box>
					)}
				</For>
			</box>
		</box>
	)
}
