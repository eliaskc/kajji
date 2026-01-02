import type { ScrollBoxRenderable } from "@opentui/core"
import { Show } from "solid-js"
import type { Commit } from "../../commander/types"
import { useCommand } from "../../context/command"
import { useFocus } from "../../context/focus"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { AnsiText } from "../AnsiText"
import { Panel } from "../Panel"

function CommitHeader(props: { commit: Commit }) {
	const { colors } = useTheme()

	return (
		<box flexDirection="column" flexShrink={0}>
			<text>
				{"Change: "}
				<span style={{ fg: colors().primary }}>{props.commit.changeId}</span>
			</text>
			<text>
				{"Commit: "}
				<span style={{ fg: colors().primary }}>{props.commit.commitId}</span>
			</text>
			<text>
				{"Author: "}
				<span style={{ fg: colors().warning }}>{props.commit.author}</span>
				{` <${props.commit.authorEmail}>`}
			</text>
			<text>
				{"Date:   "}
				<span style={{ fg: colors().success }}>{props.commit.timestamp}</span>
			</text>
			<text> </text>
			<AnsiText content={`    ${props.commit.description}`} wrapMode="none" />
			<text> </text>
		</box>
	)
}

export function MainArea() {
	const { selectedCommit, diff, diffLoading, diffError } = useSync()
	const { colors } = useTheme()
	const focus = useFocus()
	const command = useCommand()

	let scrollRef: ScrollBoxRenderable | undefined

	const isFocused = () => focus.isPanel("detail")

	command.register(() => [
		{
			id: "detail.page_up",
			title: "Page up",
			keybind: "nav_page_up",
			context: "detail",
			type: "navigation",
			onSelect: () => scrollRef?.scrollBy(-0.5, "viewport"),
		},
		{
			id: "detail.page_down",
			title: "Page down",
			keybind: "nav_page_down",
			context: "detail",
			type: "navigation",
			onSelect: () => scrollRef?.scrollBy(0.5, "viewport"),
		},
	])

	return (
		<Panel title="Detail" hotkey="3" focused={isFocused()}>
			<Show when={diffLoading()}>
				<text>Loading diff...</text>
			</Show>
			<Show when={diffError()}>
				<text>Error: {diffError()}</text>
			</Show>
			<Show when={!diffLoading() && !diffError()}>
				<scrollbox
					ref={scrollRef}
					focused={isFocused()}
					flexGrow={1}
					scrollbarOptions={{
						trackOptions: {
							backgroundColor: colors().scrollbarTrack,
							foregroundColor: colors().scrollbarThumb,
						},
					}}
				>
					<Show when={selectedCommit()} keyed>
						{(commit: Commit) => <CommitHeader commit={commit} />}
					</Show>
					<Show when={diff()}>
						<AnsiText content={diff() ?? ""} />
					</Show>
					<Show when={!diff()}>
						<text>No changes in this commit.</text>
					</Show>
				</scrollbox>
			</Show>
		</Panel>
	)
}
