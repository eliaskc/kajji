import { For, Show } from "solid-js"
import { useSync } from "../../context/sync"

export function LogPanel() {
	const { commits, selectedIndex, loading, error } = useSync()

	return (
		<box flexDirection="column" flexGrow={1}>
			<Show when={loading()}>
				<text>Loading...</text>
			</Show>
			<Show when={error()}>
				<text>Error: {error()}</text>
			</Show>
			<Show when={!loading() && !error()}>
				<For each={commits()}>
					{(commit, index) => (
						<box
							flexDirection="column"
							backgroundColor={index() === selectedIndex() ? "blue" : undefined}
						>
							<For each={commit.lines}>{(line) => <text>{line}</text>}</For>
						</box>
					)}
				</For>
			</Show>
		</box>
	)
}
