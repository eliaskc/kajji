import type { ScrollBoxRenderable } from "@opentui/core"
import { batch, createSignal, onCleanup } from "solid-js"

/**
 * Run `callback` when a ScrollBox scrolls, or when its viewport or content changes size.
 * OpenTUI reports these from native layout, so no polling is needed. Covers wheel, keys,
 * scrollbar dragging, `scrollTo`, and resizes. Returns a function that stops listening.
 */
export function observeScrollBox(ref: ScrollBoxRenderable, callback: () => void): () => void {
    const notify = () => {
        if (!ref.isDestroyed) callback()
    }
    ref.verticalScrollBar.on("change", notify)
    ref.viewport.on("resize", notify)
    ref.content.on("resize", notify)
    notify()
    queueMicrotask(notify)
    return () => {
        ref.verticalScrollBar.off("change", notify)
        ref.viewport.off("resize", notify)
        ref.content.off("resize", notify)
    }
}

export interface ScrollViewportOptions {
    defaultHeight?: number
    defaultWidth?: number
    /** Runs after each update of the signals. */
    onChange?: () => void
}

/** Signals for a ScrollBox's scroll position and viewport size, kept current by `observeScrollBox`. */
export function createScrollViewport(options: ScrollViewportOptions = {}) {
    const [top, setTop] = createSignal(0)
    const [height, setHeight] = createSignal(options.defaultHeight ?? 30)
    const [width, setWidth] = createSignal(options.defaultWidth ?? 80)
    const [current, setCurrent] = createSignal<ScrollBoxRenderable>()
    let detach: (() => void) | undefined
    const sync = () => {
        const ref = current()
        if (!ref || ref.isDestroyed) return
        batch(() => {
            setTop(Math.max(0, ref.scrollTop))
            setHeight(Math.max(1, ref.viewport.height))
            setWidth(Math.max(1, ref.viewport.width))
        })
        options.onChange?.()
    }
    const attach = (ref: ScrollBoxRenderable) => {
        detach?.()
        setCurrent(ref)
        detach = observeScrollBox(ref, sync)
    }
    onCleanup(() => {
        detach?.()
        setCurrent(undefined)
    })
    return { top, height, width, attach, sync, ref: current }
}
