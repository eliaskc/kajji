import { type Accessor, Show } from "solid-js"
import { useSync } from "../../context/sync"
import { AnsiText } from "../AnsiText"

export function MainArea() {
	const { selectedCommit, diff, diffLoading, diffError, focusedPanel } =
		useSync()
	const isFocused = () => focusedPanel() === "diff"

	const headerText = () => {
		const commit = selectedCommit()
		if (!commit) return ""
		const desc = commit.lines[1] ?? ""
		return `Change: ${commit.changeId}\nCommit: ${commit.commitId}\n${desc}\n────────────────────────────────────`
	}

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			height="100%"
			border
			borderColor={isFocused() ? "#4ECDC4" : "#444444"}
		>
			<Show when={selectedCommit()}>
				<text>{headerText()}</text>
			</Show>
			<Show when={diffLoading()}>
				<text>Loading diff...</text>
			</Show>
			<Show when={diffError()}>
				<text>Error: {diffError()}</text>
			</Show>
			<Show when={!diffLoading() && !diffError() && diff()}>
				{(content: Accessor<string>) => (
					<scrollbox
						focused={isFocused()}
						flexGrow={1}
						scrollbarOptions={{ visible: true }}
					>
						<AnsiText content={content()} />
					</scrollbox>
				)}
			</Show>
			<Show when={!diffLoading() && !diffError() && !diff()}>
				<text>No changes in this commit</text>
			</Show>
		</box>
	)
}
