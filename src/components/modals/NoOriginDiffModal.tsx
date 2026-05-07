import { useKeyboard } from "@opentui/solid"
import { useDialog } from "../../context/dialog"

export function NoOriginDiffModal() {
	const dialog = useDialog()
	useKeyboard((evt) => {
		if (evt.name === "return" || evt.name === "enter") {
			evt.preventDefault()
			evt.stopPropagation()
			dialog.close()
		}
	})
	return <text>No selected bookmark differs from origin.</text>
}
