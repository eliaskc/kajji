import { useRenderer } from "@opentui/solid"
import { Show, createEffect } from "solid-js"
import { useLayout } from "../context/layout"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { getFilesLayoutWeights } from "../utils/layout"
import { StatusBar } from "./StatusBar"
import { BookmarksPanel } from "./panels/BookmarksPanel"
import { CommandLogPanel } from "./panels/CommandLogPanel"
import { LogPanel } from "./panels/LogPanel"
import { MainArea } from "./panels/MainArea"

function VerticalDivider() {
    const { colors } = useTheme()
    return (
        <box width={1} overflow="hidden">
            <text fg={colors().backgroundElement}>{"│\n".repeat(300)}</text>
        </box>
    )
}

function HorizontalDivider() {
    const { colors } = useTheme()
    return (
        <box height={1} overflow="hidden">
            <text fg={colors().backgroundElement}>{"─".repeat(500)}</text>
        </box>
    )
}

export function LayoutGrid() {
    const renderer = useRenderer()
    const { colors } = useTheme()
    const { terminalWidth } = useLayout()
    const { activeBookmarkDiff, viewMode } = useSync()
    const isFilesView = () => viewMode() === "files"
    const isBookmarkDiffView = () => Boolean(activeBookmarkDiff())
    const filesWeights = () => getFilesLayoutWeights(terminalWidth())
    const leftWeight = () => (isFilesView() ? filesWeights().files : 1)
    const detailWeight = () =>
        isFilesView() ? filesWeights().detail : isBookmarkDiffView() ? 2 : 1

    createEffect(() => {
        renderer.setBackgroundColor(colors().background)
    })

    return (
        <box
            flexGrow={1}
            flexDirection="column"
            width="100%"
            height="100%"
            backgroundColor={colors().background}
            paddingTop={0}
            paddingBottom={0}
            gap={0}
        >
            <box flexDirection="row" flexGrow={1} gap={0}>
                <box
                    flexGrow={leftWeight()}
                    flexBasis={0}
                    flexDirection="column"
                    gap={0}
                >
                    <box
                        flexGrow={
                            !isFilesView() && !isBookmarkDiffView() ? 3 : 1
                        }
                        flexBasis={0}
                    >
                        <LogPanel filesWithRevisions={isFilesView()} />
                    </box>
                    <Show when={!isFilesView() && !isBookmarkDiffView()}>
                        <HorizontalDivider />
                        <box flexGrow={1} flexBasis={0}>
                            <BookmarksPanel />
                        </box>
                    </Show>
                </box>
                <VerticalDivider />
                <box
                    flexGrow={detailWeight()}
                    flexBasis={0}
                    flexDirection="column"
                >
                    <box flexGrow={1}>
                        <MainArea />
                    </box>
                    <Show when={!isFilesView() && !isBookmarkDiffView()}>
                        <HorizontalDivider />
                        <CommandLogPanel />
                    </Show>
                </box>
            </box>
            <box height={1} flexShrink={0} />
            <StatusBar />
        </box>
    )
}
