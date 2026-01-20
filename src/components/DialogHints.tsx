import { For, Show } from "solid-js"
import { useDialog } from "../context/dialog"
import { useTheme } from "../context/theme"

export function DialogHints() {
	const dialog = useDialog()
	const { colors, style } = useTheme()

	const hints = () => {
		const base = dialog.hints()
		if (base.length === 0) return []
		return base
	}

	const separator = () => style().statusBar.separator
	const hintGap = () => (separator() ? ` ${separator()} ` : "   ")
	const rows = () => {
		const items = hints()
		if (items.length <= 4) return [items]
		const splitAt = Math.ceil(items.length / 2)
		return [items.slice(0, splitAt), items.slice(splitAt)]
	}

	return (
		<Show when={hints().length > 0}>
			<box flexDirection="column" alignItems="center" gap={0}>
				<For each={rows()}>
					{(row) => (
						<text wrapMode="none">
							<For each={row}>
								{(hint, index) => (
									<>
										<span style={{ fg: colors().primary }}>{hint.key}</span>{" "}
										<span style={{ fg: colors().textMuted }}>{hint.label}</span>
										<Show when={index() < row.length - 1}>
											<span
												style={{
													fg: separator() ? colors().textMuted : undefined,
												}}
											>
												{hintGap()}
											</span>
										</Show>
									</>
								)}
							</For>
						</text>
					)}
				</For>
			</box>
		</Show>
	)
}
