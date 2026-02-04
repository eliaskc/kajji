import { useKeyboard } from "@opentui/solid"
import { For } from "solid-js"
import { useTheme } from "../context/theme"
import type { VersionBlock } from "../utils/changelog"
import { BorderBox } from "./BorderBox"
import { FooterHints } from "./FooterHints"
import { WaveBackground } from "./WaveBackground"

interface WhatsNewScreenProps {
	changes: VersionBlock[]
	onClose: () => void
	onDisable: () => void
}

export function WhatsNewScreen(props: WhatsNewScreenProps) {
	const { colors, style } = useTheme()

	useKeyboard((evt) => {
		if (["return", "enter", "escape", "q"].includes(evt.name ?? "")) {
			evt.preventDefault()
			evt.stopPropagation()
			props.onClose()
		} else if (evt.name === "d") {
			evt.preventDefault()
			evt.stopPropagation()
			props.onDisable()
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
				<box flexDirection="column" alignItems="center" gap={1}>
					<BorderBox
						border
						borderStyle={style().panel.borderStyle}
						borderColor={colors().borderFocused}
						backgroundColor={colors().background}
						width="80%"
						maxWidth={80}
						topLeft={<text fg={colors().borderFocused}>What's New</text>}
					>
						<scrollbox maxHeight={20} padding={1}>
							<For each={props.changes}>
								{(block) => (
									<box flexDirection="column">
										<text fg={colors().primary}>v{block.version}</text>
										<For each={block.entries}>
											{(entry) => (
												<text fg={colors().text}> - {entry.text}</text>
											)}
										</For>
										<box height={1} />
									</box>
								)}
							</For>
						</scrollbox>
					</BorderBox>
					<FooterHints
						hints={[
							{ key: "d", label: "don't show again" },
							{ key: "enter", label: "dismiss" },
						]}
						boxed
					/>
				</box>
			</box>
		</box>
	)
}
