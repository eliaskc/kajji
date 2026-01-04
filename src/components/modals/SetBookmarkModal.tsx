import { RGBA, type TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { Show, createSignal, onMount } from "solid-js"
import type { Bookmark } from "../../commander/bookmarks"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { BookmarkPicker } from "../BookmarkPicker"
import { BorderBox } from "../BorderBox"

const SINGLE_LINE_KEYBINDINGS = [
	{ name: "return", action: "submit" as const },
	{ name: "enter", action: "submit" as const },
]

interface SetBookmarkModalProps {
	title: string
	bookmarks: Bookmark[]
	changeId: string
	onMove: (bookmark: Bookmark) => void
	onCreate: (name: string) => void
}

export function SetBookmarkModal(props: SetBookmarkModalProps) {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const hasBookmarks = () => props.bookmarks.length > 0

	const [selectedBookmark, setSelectedBookmark] = createSignal<Bookmark | null>(
		props.bookmarks[0] ?? null,
	)
	const [newName, setNewName] = createSignal("")
	const [error, setError] = createSignal<string | null>(null)
	const [focusedField, setFocusedField] = createSignal<"picker" | "create">(
		hasBookmarks() ? "picker" : "create",
	)

	let inputRef: TextareaRenderable | undefined

	const focusInputAtEnd = (ref: TextareaRenderable | undefined) => {
		if (!ref) return
		ref.focus()
		ref.gotoBufferEnd()
	}

	onMount(() => {
		if (!hasBookmarks()) {
			setTimeout(() => {
				inputRef?.requestRender?.()
				focusInputAtEnd(inputRef)
			}, 1)
		}
	})

	const handleMove = () => {
		const bookmark = selectedBookmark()
		if (!bookmark) return
		dialog.close()
		props.onMove(bookmark)
	}

	const handleCreate = () => {
		const trimmed = newName().trim()
		if (!trimmed) {
			setError("Name cannot be empty")
			return
		}
		if (/\s/.test(trimmed)) {
			setError("Name cannot contain spaces")
			return
		}
		dialog.close()
		props.onCreate(trimmed)
	}

	useKeyboard((evt) => {
		if (evt.name === "escape") {
			evt.preventDefault()
			dialog.close()
		} else if (evt.name === "tab") {
			evt.preventDefault()
			if (focusedField() === "picker" && hasBookmarks()) {
				setFocusedField("create")
				focusInputAtEnd(inputRef)
			} else {
				setFocusedField("picker")
			}
		} else if (evt.name === "return" && focusedField() === "picker") {
			evt.preventDefault()
			handleMove()
		}
	})

	const handleBookmarkSelect = (bookmark: Bookmark) => {
		setSelectedBookmark(bookmark)
	}

	const pickerHeight = () =>
		Math.max(5, Math.min(12, props.bookmarks.length + 2))

	const placeholder = () => `push-${props.changeId.slice(0, 8)}`

	const pickerTitleColor = () =>
		focusedField() === "picker" ? colors().borderFocused : colors().border
	const createTitleColor = () =>
		focusedField() === "create" ? colors().borderFocused : colors().border

	return (
		<box flexDirection="column" width="60%" gap={0}>
			<Show when={hasBookmarks()}>
				<BorderBox
					border
					borderStyle={style().panel.borderStyle}
					borderColor={
						focusedField() === "picker"
							? colors().borderFocused
							: colors().border
					}
					backgroundColor={colors().background}
					height={pickerHeight()}
					topLeft={<text fg={pickerTitleColor()}>{props.title}</text>}
				>
					<BookmarkPicker
						bookmarks={props.bookmarks}
						focused={focusedField() === "picker"}
						onSelect={handleBookmarkSelect}
						height={pickerHeight() - 2}
					/>
				</BorderBox>
			</Show>

			<BorderBox
				border
				borderStyle={style().panel.borderStyle}
				borderColor={
					focusedField() === "create" ? colors().borderFocused : colors().border
				}
				backgroundColor={colors().background}
				height={3}
				topLeft={<text fg={createTitleColor()}>Create new</text>}
			>
				<textarea
					ref={(r) => {
						inputRef = r
					}}
					initialValue=""
					placeholder={placeholder()}
					onContentChange={() => {
						if (inputRef) {
							setNewName(inputRef.plainText)
							setError(null)
						}
					}}
					onSubmit={handleCreate}
					keyBindings={SINGLE_LINE_KEYBINDINGS}
					wrapMode="none"
					scrollMargin={0}
					cursorColor={colors().primary}
					textColor={colors().text}
					focusedTextColor={colors().text}
					focusedBackgroundColor={RGBA.fromInts(0, 0, 0, 0)}
					flexGrow={1}
				/>
			</BorderBox>

			<Show when={error()}>
				<box
					border
					borderStyle={style().panel.borderStyle}
					borderColor={colors().error}
					backgroundColor={colors().background}
					padding={0}
					paddingLeft={1}
				>
					<text fg={colors().error}>{error()}</text>
				</box>
			</Show>
		</box>
	)
}
