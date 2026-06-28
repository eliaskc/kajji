import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import {
    For,
    Show,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
} from "solid-js"
import { type Commit, getRevisionId } from "../commander/types"
import { useTheme } from "../context/theme"
import { createHorizontalCropScroll } from "../hooks/horizontal-crop-scroll"
import { createSelectableList } from "../hooks/selectable-list"
import { getVisibleWidth } from "../utils/ansi"
import { AnsiText } from "./AnsiText"

export interface RevisionPickerProps {
    commits: Commit[]
    defaultRevision?: string
    selectedRevision?: string
    onSelect?: (commit: Commit) => void
    focused?: boolean
    height?: number
}

export function RevisionPicker(props: RevisionPickerProps) {
    const { colors } = useTheme()

    const findDefaultIndex = () => {
        if (props.defaultRevision) {
            const idx = props.commits.findIndex(
                (c) =>
                    c.changeId === props.defaultRevision ||
                    c.commitId === props.defaultRevision,
            )
            return idx >= 0 ? idx : 0
        }
        return 0
    }

    const [selectedIndex, setSelectedIndex] = createSignal(findDefaultIndex())

    let scrollRef: ScrollBoxRenderable | undefined

    const itemOffset = (index: number) => {
        let lineOffset = 0
        const clampedIndex = Math.min(index, props.commits.length)
        for (const commit of props.commits.slice(0, clampedIndex)) {
            lineOffset += commit.lines.length
        }
        return lineOffset
    }

    const itemSize = (index: number) =>
        props.commits[Math.min(index, props.commits.length - 1)]?.lines
            .length ?? 1

    const list = createSelectableList({
        count: () => props.commits.length,
        selectedIndex,
        setSelectedIndex,
        scrollRef: () => scrollRef,
        scrollMargin: 2,
        getItemOffset: itemOffset,
        getItemSize: itemSize,
    })

    const maxContentWidth = createMemo(() =>
        props.commits.reduce(
            (max, commit) =>
                Math.max(
                    max,
                    ...commit.displayLines.map((line) =>
                        getVisibleWidth(line.content),
                    ),
                ),
            0,
        ),
    )

    const maxGutterWidth = createMemo(() =>
        props.commits.reduce(
            (max, commit) =>
                Math.max(
                    max,
                    ...commit.displayLines.map((line) =>
                        getVisibleWidth(line.gutter),
                    ),
                ),
            0,
        ),
    )

    const horizontal = createHorizontalCropScroll({
        scrollRef: () => scrollRef,
        maxContentWidth: maxContentWidth,
        viewportContentWidth: () =>
            Math.max(1, horizontal.viewportWidth() - maxGutterWidth()),
    })

    const scrollToIndex = (index: number, force = false) => {
        if (!scrollRef || props.commits.length === 0) return
        if (force) {
            const targetScroll = Math.max(0, itemOffset(index) - 2)
            scrollRef.scrollTo(targetScroll)
            list.setScrollTop(targetScroll)
            return
        }
        list.scrollSelectedIntoView()
    }

    createEffect(() => {
        const _ = props.commits
        const __ = props.defaultRevision
        list.selectProgrammatically(findDefaultIndex())
    })

    onMount(() => {
        setTimeout(() => scrollToIndex(selectedIndex(), true), 1)
        const interval = setInterval(() => {
            list.syncScrollTop()
            horizontal.syncViewportWidth()
        }, 100)
        onCleanup(() => clearInterval(interval))
    })

    createEffect(() => {
        scrollToIndex(selectedIndex())
    })

    const selectPrev = () => {
        list.selectPrevByKeyboard()
    }

    const selectNext = () => {
        list.selectNextByKeyboard()
    }

    useKeyboard((evt) => {
        if (!props.focused) return

        if (evt.name === "j" || evt.name === "down") {
            evt.preventDefault()
            evt.stopPropagation()
            selectNext()
        } else if (evt.name === "k" || evt.name === "up") {
            evt.preventDefault()
            evt.stopPropagation()
            selectPrev()
        }
    })

    createEffect(() => {
        const commit = props.commits[selectedIndex()]
        if (commit) props.onSelect?.(commit)
    })

    return (
        <Show
            when={props.commits.length > 0}
            fallback={<text fg={colors().textMuted}>No commits</text>}
        >
            <scrollbox
                ref={scrollRef}
                focused={props.focused}
                flexGrow={1}
                height={props.height}
                onMouseScroll={horizontal.onMouseScroll}
                scrollbarOptions={{ visible: false }}
            >
                <For each={props.commits}>
                    {(commit, index) => {
                        const isSelected = () => list.isSelected(index())
                        const handleMouseDown = () =>
                            list.selectByMouse(index())
                        return (
                            <For each={commit.displayLines}>
                                {(line) => {
                                    const gutterWidth = () =>
                                        getVisibleWidth(line.gutter)
                                    const contentWidth = () =>
                                        Math.max(
                                            1,
                                            horizontal.viewportWidth() -
                                                gutterWidth(),
                                        )
                                    return (
                                        <box
                                            backgroundColor={
                                                isSelected()
                                                    ? colors()
                                                          .selectionBackground
                                                    : undefined
                                            }
                                            overflow="hidden"
                                            flexDirection="row"
                                            onMouseDown={handleMouseDown}
                                        >
                                            <box
                                                flexShrink={0}
                                                overflow="hidden"
                                            >
                                                <AnsiText
                                                    content={line.gutter}
                                                    defaultFg={
                                                        isSelected()
                                                            ? colors()
                                                                  .selectionText
                                                            : undefined
                                                    }
                                                    bold={commit.isWorkingCopy}
                                                    wrapMode="none"
                                                />
                                            </box>
                                            <box flexGrow={1} overflow="hidden">
                                                <AnsiText
                                                    content={line.content}
                                                    defaultFg={
                                                        isSelected()
                                                            ? colors()
                                                                  .selectionText
                                                            : undefined
                                                    }
                                                    bold={commit.isWorkingCopy}
                                                    wrapMode="none"
                                                    cropStart={horizontal.cropStart()}
                                                    cropWidth={contentWidth()}
                                                />
                                            </box>
                                        </box>
                                    )
                                }}
                            </For>
                        )
                    }}
                </For>
            </scrollbox>
        </Show>
    )
}
