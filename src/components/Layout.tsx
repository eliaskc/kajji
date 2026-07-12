import { useRenderer } from "@opentui/solid"
import { Match, Switch, createEffect } from "solid-js"
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

function BookmarkDiffLayout() {
    return (
        <box flexDirection="row" flexGrow={1} gap={0}>
            <box flexGrow={1} flexBasis={0}>
                <LogPanel />
            </box>
            <VerticalDivider />
            <box flexGrow={2} flexBasis={0}>
                <MainArea />
            </box>
        </box>
    )
}

function FilesLayout() {
    const { terminalWidth } = useLayout()
    const weights = () => getFilesLayoutWeights(terminalWidth())

    return (
        <box flexDirection="row" flexGrow={1} gap={0}>
            <box flexGrow={weights().files} flexBasis={0}>
                <LogPanel filesWithRevisions />
            </box>
            <VerticalDivider />
            <box flexGrow={weights().detail} flexBasis={0}>
                <MainArea />
            </box>
        </box>
    )
}

function NormalLayout() {
    return (
        <box flexDirection="row" flexGrow={1} gap={0}>
            <box flexGrow={1} flexBasis={0} flexDirection="column" gap={0}>
                <box flexGrow={3} flexBasis={0}>
                    <LogPanel />
                </box>
                <HorizontalDivider />
                <box flexGrow={1} flexBasis={0}>
                    <BookmarksPanel />
                </box>
            </box>
            <VerticalDivider />
            <box flexGrow={1} flexBasis={0} flexDirection="column">
                <box flexGrow={1}>
                    <MainArea />
                </box>
                <HorizontalDivider />
                <CommandLogPanel />
            </box>
        </box>
    )
}

export function LayoutGrid() {
    const renderer = useRenderer()
    const { colors } = useTheme()
    const { layoutMode, setLayoutMode } = useLayout()
    const { activeBookmarkDiff, viewMode } = useSync()

    createEffect(() => {
        const mode = layoutMode()
        activeBookmarkDiff()
        const view = viewMode()
        if (view === "files" && mode !== "diff") setLayoutMode("diff")
        if (view !== "files" && mode === "diff") setLayoutMode("normal")
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
            <Switch>
                <Match when={viewMode() === "files"}>
                    <FilesLayout />
                </Match>
                <Match when={activeBookmarkDiff()}>
                    <BookmarkDiffLayout />
                </Match>
                <Match when={layoutMode() === "normal"}>
                    <NormalLayout />
                </Match>
            </Switch>
            <box height={1} flexShrink={0} />
            <StatusBar />
        </box>
    )
}
