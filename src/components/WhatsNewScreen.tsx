import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import type { VersionBlock } from "../utils/changelog"
import { FooterHints } from "./FooterHints"
import { WaveBackground } from "./WaveBackground"

interface WhatsNewScreenProps {
	changes: VersionBlock[]
	onClose: () => void
	onDisable: () => void
	onDisableAutoUpdates?: () => void
}

export function WhatsNewScreen(props: WhatsNewScreenProps) {
	const { colors } = useTheme()
	const [confirmAction, setConfirmAction] = createSignal<
		"disable-whats-new" | "disable-auto-updates" | null
	>(null)

	const footerHints = () => {
		const action = confirmAction()
		if (action === "disable-whats-new") {
			return [
				{ key: "d", label: "confirm don't show again" },
				{ key: "esc", label: "cancel" },
			]
		}
		if (action === "disable-auto-updates") {
			return [
				{ key: "u", label: "confirm disable auto-updates" },
				{ key: "esc", label: "cancel" },
			]
		}
		return [
			{ key: "d", label: "don't show again" },
			...(props.onDisableAutoUpdates
				? [{ key: "u", label: "disable auto-updates" }]
				: []),
			{ key: "enter", label: "dismiss" },
		]
	}

	useKeyboard((evt) => {
		const name = evt.name ?? ""
		const action = confirmAction()
		if (action) {
			if (name === "escape") {
				evt.preventDefault()
				evt.stopPropagation()
				setConfirmAction(null)
			} else if (name === "d" && action === "disable-whats-new") {
				evt.preventDefault()
				evt.stopPropagation()
				props.onDisable()
			} else if (name === "u" && action === "disable-auto-updates") {
				evt.preventDefault()
				evt.stopPropagation()
				props.onDisableAutoUpdates?.()
			}
			return
		}

		if (["return", "enter", "escape", "q"].includes(name)) {
			evt.preventDefault()
			evt.stopPropagation()
			props.onClose()
		} else if (name === "d") {
			evt.preventDefault()
			evt.stopPropagation()
			setConfirmAction("disable-whats-new")
		} else if (name === "u" && props.onDisableAutoUpdates) {
			evt.preventDefault()
			evt.stopPropagation()
			setConfirmAction("disable-auto-updates")
		}
	})

	return (
		<box flexGrow={1} width="100%" height="100%">
			<WaveBackground />
			<box
				position="absolute"
				left={0}
				top={0}
				width="100%"
				height="100%"
				zIndex={1}
				flexGrow={1}
				flexDirection="column"
				justifyContent="center"
				alignItems="center"
			>
				<box
					flexDirection="column"
					backgroundColor={colors().background}
					width="80%"
					maxWidth={80}
					paddingLeft={2}
					paddingRight={2}
					paddingTop={1}
					paddingBottom={1}
					gap={1}
				>
					<text fg={colors().text} attributes={TextAttributes.BOLD}>
						What's New
					</text>
					<scrollbox maxHeight={20}>
						<For each={props.changes}>
							{(block) => (
								<box flexDirection="column">
									<text fg={colors().primary}>v{block.version}</text>
									<For each={block.entries}>
										{(entry) => <text fg={colors().text}> - {entry.text}</text>}
									</For>
									<box height={1} />
								</box>
							)}
						</For>
					</scrollbox>
					<FooterHints hints={footerHints()} />
				</box>
			</box>
		</box>
	)
}
