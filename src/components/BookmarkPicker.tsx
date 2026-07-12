import type { ScrollBoxRenderable } from "@opentui/core"
import {
    For,
    Show,
    createEffect,
    createSignal,
    onCleanup,
    onMount,
} from "solid-js"
import type { Bookmark } from "../commander/bookmarks"
import { useDialogCommands } from "../context/command"
import { useDialog } from "../context/dialog"
import { useTheme } from "../context/theme"
import { createSelectableList } from "../hooks/selectable-list"

export interface BookmarkPickerProps {
    bookmarks: Bookmark[]
    defaultBookmark?: string
    onSelect?: (bookmark: Bookmark) => void
    focused?: boolean
    height?: number
}

export function BookmarkPicker(props: BookmarkPickerProps) {
    const { colors } = useTheme()

    const findDefaultIndex = () => {
        if (props.defaultBookmark) {
            const idx = props.bookmarks.findIndex(
                (b) => b.name === props.defaultBookmark,
            )
            return idx >= 0 ? idx : 0
        }
        return 0
    }

    const [selectedIndex, setSelectedIndex] = createSignal(findDefaultIndex())

    let scrollRef: ScrollBoxRenderable | undefined
    const list = createSelectableList({
        count: () => props.bookmarks.length,
        selectedIndex,
        setSelectedIndex,
        scrollRef: () => scrollRef,
        scrollMargin: 2,
    })

    const scrollToIndex = (index: number, force = false) => {
        if (!scrollRef || props.bookmarks.length === 0) return
        if (force) {
            const targetScroll = Math.max(0, index - 2)
            scrollRef.scrollTo(targetScroll)
            list.setScrollTop(targetScroll)
            return
        }
        list.scrollSelectedIntoView()
    }

    createEffect(() => {
        const _ = props.bookmarks
        const __ = props.defaultBookmark
        list.selectProgrammatically(findDefaultIndex())
    })

    onMount(() => {
        setTimeout(() => scrollToIndex(selectedIndex(), true), 1)
        const interval = setInterval(list.syncScrollTop, 100)
        onCleanup(() => clearInterval(interval))
    })

    createEffect(() => {
        scrollToIndex(selectedIndex())
    })

    const selectPrev = () => list.selectPrevByKeyboard()
    const selectNext = () => list.selectNextByKeyboard()

    const dialog = useDialog()
    const dialogId = dialog.currentId()
    useDialogCommands(dialogId, () =>
        props.focused
            ? [
                  {
                      id: `${dialogId}.next`,
                      title: "next",
                      keybind: "nav_down",
                      visibleIn: [],
                      allowInInput: true,
                      execute: selectNext,
                  },
                  {
                      id: `${dialogId}.previous`,
                      title: "previous",
                      keybind: "nav_up",
                      visibleIn: [],
                      allowInInput: true,
                      execute: selectPrev,
                  },
              ]
            : [],
    )

    createEffect(() => {
        const bookmark = props.bookmarks[selectedIndex()]
        if (bookmark) props.onSelect?.(bookmark)
    })

    return (
        <Show
            when={props.bookmarks.length > 0}
            fallback={<text fg={colors().textMuted}>No bookmarks</text>}
        >
            <scrollbox
                ref={scrollRef}
                focused={props.focused}
                flexGrow={1}
                height={props.height}
                scrollbarOptions={{ visible: false }}
            >
                <For each={props.bookmarks}>
                    {(bookmark, index) => {
                        const isSelected = () => list.isSelected(index())
                        return (
                            <box
                                backgroundColor={
                                    isSelected()
                                        ? colors().selectionBackground
                                        : undefined
                                }
                                overflow="hidden"
                                onMouseDown={() => list.selectByMouse(index())}
                            >
                                <text wrapMode="none">
                                    <span style={{ fg: colors().primary }}>
                                        {bookmark.name}
                                    </span>
                                    <span style={{ fg: colors().textMuted }}>
                                        {" "}
                                        {bookmark.changeId.slice(0, 8)}
                                    </span>
                                    <Show when={bookmark.description}>
                                        <span style={{ fg: colors().text }}>
                                            {" "}
                                            {bookmark.description}
                                        </span>
                                    </Show>
                                </text>
                            </box>
                        )
                    }}
                </For>
            </scrollbox>
        </Show>
    )
}
