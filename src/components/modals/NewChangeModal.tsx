import { useKeyboard } from "@opentui/solid"
import { useDialog } from "../../context/dialog"

interface NewChangeModalProps {
	onNew: () => void
	onNewAfter: () => void
	onNewBefore: () => void
}

export function NewChangeModal(props: NewChangeModalProps) {
	const dialog = useDialog()

	useKeyboard((evt) => {
		if (evt.name && evt.name.length === 1) {
			const key = evt.name.toLowerCase()
			if (key === "a") {
				evt.preventDefault()
				evt.stopPropagation()
				dialog.close()
				props.onNewAfter()
			} else if (key === "b") {
				evt.preventDefault()
				evt.stopPropagation()
				dialog.close()
				props.onNewBefore()
			}
		}
	})

	return <box />
}
