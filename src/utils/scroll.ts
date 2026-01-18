import type { ScrollBoxRenderable } from "@opentui/core"

export const FUZZY_THRESHOLD = -500

export interface ScrollIntoViewOptions {
	ref: ScrollBoxRenderable | undefined
	index: number
	currentScrollTop: number
	listLength: number
	margin?: number
}

export function calculateScrollPosition(
	options: ScrollIntoViewOptions,
): number | null {
	const { ref, index, currentScrollTop, listLength, margin = 2 } = options

	if (!ref || listLength === 0) return null

	// OpenTUI ScrollBoxRenderable doesn't expose height directly on the type,
	// but it's available at runtime via viewport or internal properties
	const refAny = ref as unknown as Record<string, unknown>
	const viewportHeight =
		(ref.viewport?.height as number | undefined) ??
		(typeof refAny.height === "number" ? refAny.height : null) ??
		(typeof refAny.rows === "number" ? refAny.rows : null) ??
		10

	const visibleStart = currentScrollTop
	const visibleEnd = currentScrollTop + viewportHeight - 1
	const safeStart = visibleStart + margin
	const safeEnd = visibleEnd - margin

	let newScrollTop = currentScrollTop
	if (index < safeStart) {
		newScrollTop = Math.max(0, index - margin)
	} else if (index > safeEnd) {
		newScrollTop = Math.max(0, index - viewportHeight + margin + 1)
	}

	if (newScrollTop !== currentScrollTop) {
		return newScrollTop
	}

	return null
}

export function scrollIntoView(
	options: ScrollIntoViewOptions & {
		setScrollTop: (n: number) => void
	},
): void {
	const { ref, setScrollTop, ...rest } = options
	const newScrollTop = calculateScrollPosition({ ref, ...rest })

	if (newScrollTop !== null && ref) {
		ref.scrollTo(newScrollTop)
		setScrollTop(newScrollTop)
	}
}
