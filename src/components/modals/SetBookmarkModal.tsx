import {
	RGBA,
	type ScrollBoxRenderable,
	type TextareaRenderable,
} from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { Bookmark } from "../../commander/bookmarks"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { FUZZY_THRESHOLD, scrollIntoView } from "../../utils/scroll"
import { BorderBox } from "../BorderBox"

const SINGLE_LINE_KEYBINDINGS = [
	{ name: "return", action: "submit" as const },
	{ name: "enter", action: "submit" as const },
]

interface SetBookmarkModalProps {
	title: string
	bookmarks: Bookmark[]
	currentRevisionBookmarks?: Bookmark[]
	changeId: string
	onMove: (bookmark: Bookmark) => void
	onCreate: (name: string) => void
}

type ListItem =
	| { type: "current"; bookmark: Bookmark }
	| { type: "bookmark"; bookmark: Bookmark }
	| { type: "create"; name: string }

export function SetBookmarkModal(props: SetBookmarkModalProps) {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const [query, setQuery] = createSignal("")
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	const [error, setError] = createSignal<string | null>(null)
	const [scrollTop, setScrollTop] = createSignal(0)

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

	const showCreateOption = createMemo(() => {
		const q = query().trim()
		if (!q) return false
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
				name: query().trim(),
			})
		}

		return items
	})

	const totalItems = createMemo(() => listItems().length)

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
		return `push-${props.changeId.slice(0, 8)}`
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
		scrollIntoView({
			ref: scrollRef,
			index: selectedIndex(),
			currentScrollTop: scrollTop(),
			listLength: totalItems(),
			setScrollTop,
		})
	})

	const selectPrev = () => {
		const current = selectedIndex()
		for (let i = current - 1; i >= 0; i--) {
			if (isSelectableIndex(i)) {
				setSelectedIndex(i)
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
				setSelectedIndex(i)
				return
			}
		}
	}

	const handleSubmit = () => {
		setError(null)

		if (isCreateSelected()) {
			const name = query().trim()
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
				dialog.close()
				props.onMove(bookmark)
			}
		}
	}

	useKeyboard((evt) => {
		if (evt.name === "escape") {
			evt.preventDefault()
			evt.stopPropagation()
			dialog.close()
		} else if (evt.name === "down") {
			evt.preventDefault()
			evt.stopPropagation()
			selectNext()
		} else if (evt.name === "up") {
			evt.preventDefault()
			evt.stopPropagation()
			selectPrev()
		}
	})

	const hasBookmarks = () => props.bookmarks.length > 0
	const showPlaceholderText = () => !query().trim() && !hasBookmarks()

	const LIST_HEIGHT = 10

	return (
		<BorderBox
			border
			borderStyle={style().panel.borderStyle}
			borderColor={colors().borderFocused}
			backgroundColor={colors().background}
			width="60%"
			maxWidth={90}
			topLeft={<text fg={colors().borderFocused}>{props.title}</text>}
		>
			<box flexDirection="column">
				{/* Search/create input */}
				<box paddingLeft={1} paddingRight={1}>
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
				</box>

				{/* Divider */}
				<box height={1} overflow="hidden">
					<text fg={colors().textMuted} wrapMode="none">
						{"─".repeat(200)}
					</text>
				</box>

				{/* Filtered list + create option - unified rendering */}
				<Show
					when={!showPlaceholderText()}
					fallback={
						<box height={LIST_HEIGHT} paddingLeft={1} paddingRight={1}>
							<text fg={colors().textMuted}>Type to create a bookmark</text>
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
										<box paddingLeft={1} paddingRight={1}>
											<text fg={colors().textMuted} wrapMode="none">
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
												isSelected() ? colors().selectionBackground : undefined
											}
											paddingLeft={1}
											paddingRight={1}
											onMouseDown={() => setSelectedIndex(index())}
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
								}

								// Create option
								return (
									<box
										backgroundColor={
											isSelected() ? colors().selectionBackground : undefined
										}
										paddingLeft={1}
										paddingRight={1}
										onMouseDown={() => setSelectedIndex(index())}
									>
										<text fg={colors().textMuted} wrapMode="none">
											+ Create "{item.name}"
										</text>
									</box>
								)
							}}
						</For>
					</scrollbox>
				</Show>

				{/* Error display */}
				<Show when={error()}>
					<box
						border
						borderStyle={style().panel.borderStyle}
						borderColor={colors().error}
						marginLeft={1}
						marginRight={1}
						marginBottom={1}
						paddingLeft={1}
					>
						<text fg={colors().error}>{error()}</text>
					</box>
				</Show>
			</box>
		</BorderBox>
	)
}
