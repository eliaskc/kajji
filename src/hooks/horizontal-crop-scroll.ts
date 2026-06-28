import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import type { Accessor } from "solid-js"
import { createSignal } from "solid-js"

export interface HorizontalCropScrollOptions {
    scrollRef: Accessor<ScrollBoxRenderable | undefined>
    maxContentWidth: Accessor<number>
    viewportContentWidth?: Accessor<number>
    defaultViewportWidth?: number
}

export function createHorizontalCropScroll(
    options: HorizontalCropScrollOptions,
) {
    const [scrollLeft, setScrollLeftRaw] = createSignal(0)
    const [viewportWidth, setViewportWidth] = createSignal(
        options.defaultViewportWidth ?? 80,
    )

    const effectiveViewportWidth = () =>
        options.viewportContentWidth?.() ?? viewportWidth()

    const clamp = (value: number) => {
        const maxScroll = Math.max(
            0,
            options.maxContentWidth() - effectiveViewportWidth(),
        )
        return Math.max(0, Math.min(value, maxScroll))
    }

    const setScrollLeft = (value: number) => setScrollLeftRaw(clamp(value))

    const syncViewportWidth = () => {
        const width = options.scrollRef()?.viewport?.width ?? viewportWidth()
        if (width !== viewportWidth()) setViewportWidth(width)
        setScrollLeftRaw(clamp(scrollLeft()))
    }

    const onMouseScroll = (event: MouseEvent) => {
        if (!event.scroll) return
        const direction = event.scroll.direction
        if (direction !== "left" && direction !== "right") return

        const viewport = options.scrollRef()?.viewport
        if (
            viewport &&
            (event.x < viewport.screenX ||
                event.x >= viewport.screenX + viewport.width ||
                event.y < viewport.screenY ||
                event.y >= viewport.screenY + viewport.height)
        ) {
            return
        }

        const delta = event.scroll.delta || 1
        setScrollLeft(
            direction === "left" ? scrollLeft() - delta : scrollLeft() + delta,
        )
        event.preventDefault()
        event.stopPropagation()
    }

    return {
        scrollLeft,
        setScrollLeft,
        viewportWidth,
        setViewportWidth,
        syncViewportWidth,
        onMouseScroll,
        cropStart: scrollLeft,
        cropWidth: () => Math.max(1, viewportWidth()),
    }
}
