import { For, Show } from "solid-js"
import { useSync } from "../../context/sync"

function formatCommitLine(
	changeId: string,
	isWorkingCopy: boolean,
	immutable: boolean,
): string {
	const marker = isWorkingCopy ? "@" : immutable ? "◆" : "○"
	const shortId = changeId.slice(0, 8)
	return `${marker} ${shortId}`
}

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
		>
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
							backgroundColor={index() === selectedIndex() ? "blue" : undefined}
						>
							<text>
								{formatCommitLine(
									commit.changeId,
									commit.isWorkingCopy,
									commit.immutable,
								)}
							</text>
						</box>
					)}
				</For>
			</Show>
		</box>
	)
}
