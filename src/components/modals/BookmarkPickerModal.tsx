import { useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Bookmark } from "../../commander/bookmarks"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { BookmarkPicker } from "../BookmarkPicker"

interface BookmarkPickerModalProps {
	title: string
	bookmarks: Bookmark[]
	defaultBookmark?: string
	width?: number | "auto" | `${number}%`
	height?: number
	onSelect: (bookmark: Bookmark) => void
}

export function BookmarkPickerModal(props: BookmarkPickerModalProps) {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const [selectedBookmark, setSelectedBookmark] = createSignal<Bookmark | null>(
		props.bookmarks.find((b) => b.name === props.defaultBookmark) ??
			props.bookmarks[0] ??
			null,
	)

	const handleConfirm = () => {
		const bookmark = selectedBookmark()
		if (!bookmark) return
		dialog.close()
		props.onSelect(bookmark)
	}

	useKeyboard((evt) => {
		if (evt.name === "escape") {
			evt.preventDefault()
			dialog.close()
		} else if (evt.name === "return") {
			evt.preventDefault()
			handleConfirm()
		}
	})

	const handleBookmarkSelect = (bookmark: Bookmark) => {
		setSelectedBookmark(bookmark)
	}

	const pickerHeight = () => props.height ?? 12

	return (
		<box flexDirection="column" width={props.width ?? "60%"} gap={0}>
			<box
				flexDirection="column"
				border
				borderStyle={style().panel.borderStyle}
				borderColor={colors().borderFocused}
				backgroundColor={colors().background}
				height={pickerHeight()}
				padding={0}
				title={props.title}
			>
				<BookmarkPicker
					bookmarks={props.bookmarks}
					defaultBookmark={props.defaultBookmark}
					focused={true}
					onSelect={handleBookmarkSelect}
					height={pickerHeight() - 2}
				/>
			</box>
		</box>
	)
}
