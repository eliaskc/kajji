import { RGBA, type TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { Show, createSignal, onMount } from "solid-js"
import type { Commit } from "../../commander/types"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"
import { BorderBox } from "../BorderBox"
import { RevisionPicker } from "../RevisionPicker"

const SINGLE_LINE_KEYBINDINGS = [
	{ name: "return", action: "submit" as const },
	{ name: "enter", action: "submit" as const },
]

interface BookmarkNameModalProps {
	title: string
	commits?: Commit[]
	defaultRevision?: string
	initialValue?: string
	placeholder?: string
	width?: number | "auto" | `${number}%`
	height?: number
	onSave: (name: string, revision?: string) => void
}

export function BookmarkNameModal(props: BookmarkNameModalProps) {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const hasRevisionPicker = () => (props.commits?.length ?? 0) > 0

	const [selectedRevision, setSelectedRevision] = createSignal(
		props.defaultRevision ?? props.commits?.[0]?.changeId ?? "",
	)
	const [name, setName] = createSignal(props.initialValue ?? "")
	const [error, setError] = createSignal<string | null>(null)
	const [focusedField, setFocusedField] = createSignal<"name" | "picker">(
		"name",
	)

	let inputRef: TextareaRenderable | undefined

	const focusInputAtEnd = (ref: TextareaRenderable | undefined) => {
		if (!ref) return
		ref.focus()
		ref.gotoBufferEnd()
	}

	onMount(() => {
		setTimeout(() => {
			inputRef?.requestRender?.()
			focusInputAtEnd(inputRef)
		}, 1)
	})

	const generatedName = () => {
		if (!hasRevisionPicker()) return props.placeholder ?? ""
		const rev = selectedRevision()
		return rev ? `push-${rev.slice(0, 8)}` : "push-bookmark"
	}

	const handleSave = () => {
		const trimmed = name().trim()
		const finalName = trimmed || generatedName()

		if (!finalName) {
			setError("Name cannot be empty")
			return
		}
		if (/\s/.test(finalName)) {
			setError("Name cannot contain spaces")
			return
		}

		dialog.close()
		if (hasRevisionPicker()) {
			props.onSave(finalName, selectedRevision())
		} else {
			props.onSave(finalName)
		}
	}

	useKeyboard((evt) => {
		if (evt.name === "escape") {
			evt.preventDefault()
			dialog.close()
		} else if (evt.name === "tab" && hasRevisionPicker()) {
			evt.preventDefault()
			if (focusedField() === "name") {
				setFocusedField("picker")
			} else {
				setFocusedField("name")
				focusInputAtEnd(inputRef)
			}
		} else if (evt.name === "return" && focusedField() === "picker") {
			evt.preventDefault()
			handleSave()
		}
	})

	const handleRevisionSelect = (commit: Commit) => {
		setSelectedRevision(commit.changeId)
	}

	const pickerHeight = () => props.height ?? 10

	const nameTitleColor = () =>
		focusedField() === "name" || !hasRevisionPicker()
			? colors().borderFocused
			: colors().border
	const revisionTitleColor = () =>
		focusedField() === "picker" ? colors().borderFocused : colors().border

	return (
		<box flexDirection="column" width={props.width ?? "60%"} gap={0}>
			<BorderBox
				border
				borderStyle={style().panel.borderStyle}
				borderColor={
					focusedField() === "name" || !hasRevisionPicker()
						? colors().borderFocused
						: colors().border
				}
				backgroundColor={colors().background}
				height={3}
				topLeft={<text fg={nameTitleColor()}>{props.title}</text>}
			>
				<textarea
					ref={(r) => {
						inputRef = r
					}}
					initialValue={props.initialValue ?? ""}
					placeholder={generatedName()}
					onContentChange={() => {
						if (inputRef) {
							setName(inputRef.plainText)
							setError(null)
						}
					}}
					onSubmit={handleSave}
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

			<Show when={hasRevisionPicker()}>
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
					topLeft={<text fg={revisionTitleColor()}>Revision</text>}
				>
					<RevisionPicker
						commits={props.commits ?? []}
						defaultRevision={props.defaultRevision}
						focused={focusedField() === "picker"}
						onSelect={handleRevisionSelect}
						height={pickerHeight() - 2}
					/>
				</BorderBox>
			</Show>
		</box>
	)
}
