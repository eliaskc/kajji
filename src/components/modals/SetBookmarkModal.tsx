import {
    RGBA,
    type ScrollBoxRenderable,
    type TextareaRenderable,
} from "@opentui/core"
import fuzzysort from "fuzzysort"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import {
    type Bookmark,
    isBookmarkBackwardsError,
} from "../../commander/bookmarks"
import type { OperationResult } from "../../commander/operations"
import { useCommandInputGuard, useDialogCommands } from "../../context/command"
import { DIALOG_SIZE, useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { createSelectableList } from "../../hooks/selectable-list"
import { FUZZY_THRESHOLD } from "../../utils/scroll"

const SINGLE_LINE_KEYBINDINGS = [
    { name: "return", action: "submit" as const },
    { name: "enter", action: "submit" as const },
]

interface SetBookmarkModalProps {
    bookmarks: Bookmark[]
    currentRevisionBookmarks?: Bookmark[]
    changeId: string
    onMove: (
        bookmark: Bookmark,
        options?: { allowBackwards?: boolean },
    ) => Promise<OperationResult>
    onCreate: (name: string) => void
}

type ListItem =
    | { type: "current"; bookmark: Bookmark }
    | { type: "bookmark"; bookmark: Bookmark }
    | { type: "create"; name: string }

export function SetBookmarkModal(props: SetBookmarkModalProps) {
    const dialog = useDialog()
    const { colors, style } = useTheme()
    useCommandInputGuard()

    const [query, setQuery] = createSignal("")
    const [selectedIndex, setSelectedIndex] = createSignal(0)
    const [error, setError] = createSignal<string | null>(null)

    let inputRef: TextareaRenderable | undefined
    let scrollRef: ScrollBoxRenderable | undefined

    const filteredBookmarks = createMemo(() => {
        const q = query().trim()
        if (!q) return props.bookmarks

        const results = fuzzysort.go(q, props.bookmarks, {
            key: "name",
            threshold: FUZZY_THRESHOLD,
            limit: 50,
        })
        return results.map((r) => r.obj)
    })

    const defaultCreateName = createMemo(
        () => `push-${props.changeId.slice(0, 8)}`,
    )

    const showCreateOption = createMemo(() => {
        const q = query().trim()
        if (!q) return props.bookmarks.length === 0
        return !props.bookmarks.some((b) => b.name === q)
    })

    const listItems = createMemo((): ListItem[] => {
        const items: ListItem[] = (props.currentRevisionBookmarks ?? []).map(
            (b) => ({
                type: "current" as const,
                bookmark: b,
            }),
        )

        items.push(
            ...filteredBookmarks().map((b) => ({
                type: "bookmark" as const,
                bookmark: b,
            })),
        )

        if (showCreateOption()) {
            items.push({
                type: "create" as const,
                name: query().trim() || defaultCreateName(),
            })
        }

        return items
    })

    const totalItems = createMemo(() => listItems().length)

    const list = createSelectableList({
        count: totalItems,
        selectedIndex,
        setSelectedIndex,
        scrollRef: () => scrollRef,
    })

    const firstSelectableIndex = createMemo(() => {
        const items = listItems()
        for (let i = 0; i < items.length; i++) {
            if (items[i]?.type !== "current") return i
        }
        return -1
    })

    const isCreateSelected = createMemo(() => {
        const items = listItems()
        const item = items[selectedIndex()]
        return item?.type === "create"
    })

    const selectedBookmark = createMemo(() => {
        const items = listItems()
        const item = items[selectedIndex()]
        if (item?.type === "bookmark") return item.bookmark
        return null
    })

    const isSelectableIndex = (index: number) => {
        const item = listItems()[index]
        return item?.type === "bookmark" || item?.type === "create"
    }

    const placeholder = createMemo(() => {
        const bookmark = selectedBookmark()
        if (bookmark) return bookmark.name
        return defaultCreateName()
    })

    createEffect(() => {
        const total = totalItems()
        const firstSelectable = firstSelectableIndex()
        if (total === 0 || firstSelectable === -1) {
            setSelectedIndex(0)
            return
        }
        if (selectedIndex() >= total) {
            setSelectedIndex(firstSelectable)
            return
        }
        if (!isSelectableIndex(selectedIndex())) {
            setSelectedIndex(firstSelectable)
        }
    })

    createEffect(() => {
        const items = listItems()
        if (items.length === 1 && items[0]?.type === "create") {
            setSelectedIndex(0)
        }
    })

    createEffect(() => {
        list.scrollSelectedIntoView()
    })

    const selectPrev = () => {
        const current = selectedIndex()
        for (let i = current - 1; i >= 0; i--) {
            if (isSelectableIndex(i)) {
                list.selectByKeyboard(i)
                return
            }
        }
    }

    const selectNext = () => {
        const max = totalItems() - 1
        if (max < 0) return
        const current = selectedIndex()
        for (let i = current + 1; i <= max; i++) {
            if (isSelectableIndex(i)) {
                list.selectByKeyboard(i)
                return
            }
        }
    }

    const handleSubmit = async () => {
        setError(null)

        if (isCreateSelected()) {
            const name = query().trim() || defaultCreateName()
            if (!name) {
                setError("Name cannot be empty")
                return
            }
            if (/\s/.test(name)) {
                setError("Name cannot contain spaces")
                return
            }
            dialog.close()
            props.onCreate(name)
        } else {
            const bookmark = selectedBookmark()
            if (bookmark) {
                const result = await props.onMove(bookmark)
                if (isBookmarkBackwardsError(result)) {
                    const confirmed = await dialog.confirm({
                        ...DIALOG_SIZE.confirm,
                        message: [
                            { text: bookmark.name, style: "target" },
                            " would move backwards. ",
                            { text: "Move", style: "action" },
                            " anyway?",
                        ],
                    })
                    if (!confirmed) return
                    const retryResult = await props.onMove(bookmark, {
                        allowBackwards: true,
                    })
                    if (retryResult.success) {
                        dialog.close()
                    }
                    return
                }

                if (result.success) {
                    dialog.close()
                }
            }
        }
    }

    const dialogId = dialog.currentId()
    useDialogCommands(dialogId, () => [
        {
            id: `${dialogId}.next`,
            title: "next",
            keybind: "input_nav_down",
            visibleIn: [],
            allowInInput: true,
            execute: selectNext,
        },
        {
            id: `${dialogId}.previous`,
            title: "previous",
            keybind: "input_nav_up",
            visibleIn: [],
            allowInInput: true,
            execute: selectPrev,
        },
        {
            id: `${dialogId}.submit`,
            title: "confirm",
            keybind: "enter",
            execute: () => void handleSubmit(),
        },
    ])

    const hasBookmarks = () => props.bookmarks.length > 0
    const showPlaceholderText = () =>
        !query().trim() && !hasBookmarks() && totalItems() === 0

    const LIST_HEIGHT = 10

    return (
        <box flexDirection="column" gap={1}>
            <textarea
                ref={(r) => {
                    inputRef = r
                    queueMicrotask(() => {
                        r.requestRender?.()
                        r.focus()
                    })
                }}
                initialValue=""
                placeholder={placeholder()}
                placeholderColor={colors().textMuted}
                onContentChange={() => {
                    if (inputRef) {
                        setQuery(inputRef.plainText)
                        setError(null)
                        const nextIndex = firstSelectableIndex()
                        setSelectedIndex(nextIndex >= 0 ? nextIndex : 0)
                    }
                }}
                onSubmit={handleSubmit}
                keyBindings={SINGLE_LINE_KEYBINDINGS}
                wrapMode="none"
                scrollMargin={0}
                cursorColor={colors().primary}
                textColor={colors().text}
                focusedTextColor={colors().text}
                focusedBackgroundColor={RGBA.fromInts(0, 0, 0, 0)}
                flexGrow={1}
            />

            <Show
                when={!showPlaceholderText()}
                fallback={
                    <box height={LIST_HEIGHT}>
                        <text fg={colors().textMuted}>
                            Type to create a bookmark
                        </text>
                    </box>
                }
            >
                <scrollbox
                    ref={scrollRef}
                    height={LIST_HEIGHT}
                    scrollbarOptions={{ visible: false }}
                >
                    <For each={listItems()}>
                        {(item, index) => {
                            const isSelected = () => index() === selectedIndex()
                            if (item.type === "current") {
                                return (
                                    <box>
                                        <text
                                            fg={colors().textMuted}
                                            wrapMode="none"
                                        >
                                            {item.bookmark.name}{" "}
                                            {item.bookmark.changeId.slice(0, 8)}
                                        </text>
                                    </box>
                                )
                            }

                            if (item.type === "bookmark") {
                                const bookmark = item.bookmark
                                return (
                                    <box
                                        backgroundColor={
                                            isSelected()
                                                ? colors().selectionBackground
                                                : undefined
                                        }
                                        onMouseDown={() =>
                                            list.selectByMouse(index())
                                        }
                                    >
                                        <text wrapMode="none">
                                            <span
                                                style={{ fg: colors().primary }}
                                            >
                                                {bookmark.name}
                                            </span>
                                            <span
                                                style={{
                                                    fg: colors().textMuted,
                                                }}
                                            >
                                                {" "}
                                                {bookmark.changeId.slice(0, 8)}
                                            </span>
                                            <Show when={bookmark.description}>
                                                <span
                                                    style={{
                                                        fg: colors().text,
                                                    }}
                                                >
                                                    {" "}
                                                    {bookmark.description}
                                                </span>
                                            </Show>
                                        </text>
                                    </box>
                                )
                            }

                            return (
                                <box
                                    backgroundColor={
                                        isSelected()
                                            ? colors().selectionBackground
                                            : undefined
                                    }
                                    onMouseDown={() =>
                                        list.selectByMouse(index())
                                    }
                                >
                                    <text
                                        fg={colors().textMuted}
                                        wrapMode="none"
                                    >
                                        + Create "{item.name}"
                                    </text>
                                </box>
                            )
                        }}
                    </For>
                </scrollbox>
            </Show>

            <Show when={error()}>
                <text fg={colors().error}>{error()}</text>
            </Show>
        </box>
    )
}
