import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createEffect, createSignal, onMount } from "solid-js"
import type { Bookmark } from "../commander/bookmarks"
import { useTheme } from "../context/theme"

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
	const [scrollTop, setScrollTop] = createSignal(0)

	const scrollToIndex = (index: number, force = false) => {
		const bookmarkList = props.bookmarks
		if (!scrollRef || bookmarkList.length === 0) return

		const margin = 2
		const refAny = scrollRef as unknown as Record<string, unknown>
		const viewportHeight =
			(typeof refAny.height === "number" ? refAny.height : null) ??
			(typeof refAny.rows === "number" ? refAny.rows : null) ??
			10
		const currentScrollTop = scrollTop()

		if (force) {
			const targetScroll = Math.max(0, index - margin)
			scrollRef.scrollTo(targetScroll)
			setScrollTop(targetScroll)
			return
		}

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
			scrollRef.scrollTo(newScrollTop)
			setScrollTop(newScrollTop)
		}
	}

	createEffect(() => {
		const _ = props.bookmarks
		const __ = props.defaultBookmark
		setSelectedIndex(findDefaultIndex())
	})

	onMount(() => {
		setTimeout(() => scrollToIndex(selectedIndex(), true), 1)
	})

	createEffect(() => {
		scrollToIndex(selectedIndex())
	})

	const selectPrev = () => {
		setSelectedIndex((i) => {
			const newIndex = Math.max(0, i - 1)
			const bookmark = props.bookmarks[newIndex]
			if (bookmark) props.onSelect?.(bookmark)
			return newIndex
		})
	}

	const selectNext = () => {
		setSelectedIndex((i) => {
			const newIndex = Math.min(props.bookmarks.length - 1, i + 1)
			const bookmark = props.bookmarks[newIndex]
			if (bookmark) props.onSelect?.(bookmark)
			return newIndex
		})
	}

	useKeyboard((evt) => {
		if (!props.focused) return

		if (evt.name === "j" || evt.name === "down") {
			evt.preventDefault()
			selectNext()
		} else if (evt.name === "k" || evt.name === "up") {
			evt.preventDefault()
			selectPrev()
		}
	})

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
						const isSelected = () => index() === selectedIndex()
						return (
							<box
								backgroundColor={
									isSelected() ? colors().selectionBackground : undefined
								}
								overflow="hidden"
								paddingLeft={1}
								paddingRight={1}
							>
								<text>
									<span style={{ fg: colors().primary }}>{bookmark.name}</span>
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
