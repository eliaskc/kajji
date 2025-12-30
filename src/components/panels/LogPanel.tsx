import { For, Show } from "solid-js"
import { useSync } from "../../context/sync"
import { AnsiText } from "../AnsiText"

export function LogPanel() {
	const { commits, selectedIndex, loading, error, focusedPanel } = useSync()
	const isFocused = () => focusedPanel() === "log"

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			height="100%"
			border
			borderColor={isFocused() ? "#4ECDC4" : "#444444"}
			overflow="hidden"
			gap={0}
		>
			<Show when={loading()}>
				<text>Loading...</text>
			</Show>
			<Show when={error()}>
				<text>Error: {error()}</text>
			</Show>
			<Show when={!loading() && !error()}>
				<For each={commits()}>
					{(commit, index) => {
						const isSelected = () => index() === selectedIndex()
						return (
							<For each={commit.lines}>
								{(line) => (
									<box backgroundColor={isSelected() ? "blue" : undefined} overflow="hidden">
										<AnsiText content={line} />
									</box>
								)}
							</For>
						)
					}}
				</For>
			</Show>
		</box>
	)
}
