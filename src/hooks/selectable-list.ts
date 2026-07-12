import type { ScrollBoxRenderable } from "@opentui/core"
import type { Accessor } from "solid-js"
import { createSignal, untrack } from "solid-js"
import { type SelectionSource, scrollIntoView } from "../utils/scroll"

export interface SelectableListOptions {
    count: Accessor<number>
    selectedIndex: Accessor<number>
    setSelectedIndex: (index: number) => void
    scrollRef?: Accessor<ScrollBoxRenderable | undefined>
    scrollMargin?: number
    getItemSize?: (index: number) => number
    getItemOffset?: (index: number) => number
    onNearEnd?: {
        remaining?: number
        hasMore: Accessor<boolean>
        loading?: Accessor<boolean>
        loadMore: () => void
    }
}

export function createSelectableList(options: SelectableListOptions) {
    const [selectionSource, setSelectionSource] =
        createSignal<SelectionSource>("programmatic")
    const [scrollTop, setScrollTop] = createSignal(0)

    const setIndex = (index: number) => {
        const max = options.count() - 1
        if (max < 0) return
        const next = Math.max(0, Math.min(max, index))
        options.setSelectedIndex(next)
    }

    const maybeLoadMore = (index: number) => {
        const nearEnd = options.onNearEnd
        if (!nearEnd) return
        if (nearEnd.loading?.()) return
        if (!nearEnd.hasMore()) return
        const remaining = nearEnd.remaining ?? 5
        if (options.count() - index <= remaining) {
            nearEnd.loadMore()
        }
    }

    const selectByKeyboard = (index: number) => {
        setSelectionSource("keyboard")
        setIndex(index)
        maybeLoadMore(index)
    }

    const selectNextByKeyboard = () => {
        selectByKeyboard(options.selectedIndex() + 1)
    }

    const selectPrevByKeyboard = () => {
        selectByKeyboard(options.selectedIndex() - 1)
    }

    const selectByMouse = (index: number) => {
        setSelectionSource("mouse")
        setIndex(index)
    }

    const selectProgrammatically = (index: number) => {
        setSelectionSource("programmatic")
        setIndex(index)
    }

    const isSelected = (index: number) => index === options.selectedIndex()

    const syncScrollTop = () => {
        const ref = options.scrollRef?.()
        if (!ref) return
        const current = ref.scrollTop ?? 0
        if (current !== scrollTop()) setScrollTop(current)
    }

    const scrollSelectedIntoView = () => {
        const ref = options.scrollRef?.()
        if (!ref) return
        const selected = options.selectedIndex()
        const index = options.getItemOffset?.(selected) ?? selected
        scrollIntoView({
            ref,
            index,
            currentScrollTop: untrack(scrollTop),
            listLength: options.count(),
            margin: options.scrollMargin,
            itemSize: options.getItemSize?.(selected),
            setScrollTop,
            selectionSource: selectionSource(),
        })
    }

    return {
        selectionSource,
        setSelectionSource,
        scrollTop,
        setScrollTop,
        syncScrollTop,
        scrollSelectedIntoView,
        isSelected,
        selectByKeyboard,
        selectNextByKeyboard,
        selectPrevByKeyboard,
        selectByMouse,
        selectProgrammatically,
    }
}
