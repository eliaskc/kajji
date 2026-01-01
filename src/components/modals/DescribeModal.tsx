import { type InputRenderable, RGBA } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createSignal, onMount } from "solid-js"
import { useDialog } from "../../context/dialog"
import { useTheme } from "../../context/theme"

interface DescribeModalProps {
	initialSubject: string
	initialBody: string
	onSave: (subject: string, body: string) => void
}

export function DescribeModal(props: DescribeModalProps) {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const [subject, setSubject] = createSignal(props.initialSubject)
	const [body, setBody] = createSignal(props.initialBody)
	const [focusedField, setFocusedField] = createSignal<"subject" | "body">(
		"subject",
	)

	let subjectRef: InputRenderable | undefined
	let bodyRef: InputRenderable | undefined

	const focusAtEnd = (ref: InputRenderable | undefined) => {
		if (!ref) return
		ref.focus()
		ref.cursorPosition = ref.value.length
	}

	onMount(() => {
		setTimeout(() => focusAtEnd(subjectRef), 1)
	})

	const handleSave = () => {
		dialog.close()
		props.onSave(subject(), body())
	}

	useKeyboard((evt) => {
		if (evt.name === "tab") {
			evt.preventDefault()
			if (focusedField() === "subject") {
				setFocusedField("body")
				focusAtEnd(bodyRef)
			} else {
				setFocusedField("subject")
				focusAtEnd(subjectRef)
			}
		}
	})

	const charCount = () => subject().length

	return (
		<box flexDirection="column" width="60%" gap={0}>
			<box
				flexDirection="column"
				border
				borderStyle={style().panel.borderStyle}
				borderColor={
					focusedField() === "subject"
						? colors().borderFocused
						: colors().border
				}
				backgroundColor={colors().background}
				height={3}
				padding={0}
				title={`Subject─[${charCount()}]`}
			>
				<input
					ref={subjectRef}
					value={props.initialSubject}
					onInput={(value) => setSubject(value)}
					onSubmit={handleSave}
					cursorColor={colors().primary}
					textColor={colors().text}
					focusedTextColor={colors().text}
					focusedBackgroundColor={RGBA.fromInts(0, 0, 0, 0)}
					flexGrow={1}
				/>
			</box>

			<box
				flexDirection="column"
				border
				borderStyle={style().panel.borderStyle}
				borderColor={
					focusedField() === "body" ? colors().borderFocused : colors().border
				}
				backgroundColor={colors().background}
				height={10}
				padding={0}
				title="Body"
			>
				<input
					ref={bodyRef}
					value={props.initialBody}
					onInput={(value) => setBody(value)}
					cursorColor={colors().primary}
					textColor={colors().text}
					focusedTextColor={colors().text}
					focusedBackgroundColor={RGBA.fromInts(0, 0, 0, 0)}
					flexGrow={1}
				/>
			</box>
		</box>
	)
}
