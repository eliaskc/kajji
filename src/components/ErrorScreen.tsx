import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { type ParsedJjError, parseJjError } from "../utils/error-parser"
import { FooterHints } from "./FooterHints"
import { WaveBackground } from "./WaveBackground"

export interface ErrorScreenProps {
	error: string
	onRetry: () => void | Promise<void>
	onFix?: () => Promise<void>
	onQuit: () => void
}

export function ErrorScreen(props: ErrorScreenProps) {
	const { colors } = useTheme()
	const [isFixing, setIsFixing] = createSignal(false)
	const [isRetrying, setIsRetrying] = createSignal(false)
	const [attempts, setAttempts] = createSignal(1)

	const isLoading = () => isFixing() || isRetrying()

	const parsedError = (): ParsedJjError => parseJjError(props.error)

	const canFix = () => parsedError().fixCommand !== null && props.onFix

	type Action = "fix" | "retry"
	const [selectedAction, setSelectedAction] = createSignal<Action>(
		canFix() ? "fix" : "retry",
	)

	const handleFix = async () => {
		if (!props.onFix) return
		setIsFixing(true)
		try {
			await props.onFix()
			setAttempts((n) => n + 1)
		} finally {
			setIsFixing(false)
		}
	}

	const handleRetry = async () => {
		setIsRetrying(true)
		try {
			await Promise.resolve(props.onRetry())
			setAttempts((n) => n + 1)
		} finally {
			setIsRetrying(false)
		}
	}

	useKeyboard((evt) => {
		if (isLoading()) return

		if (evt.name === "q") {
			evt.preventDefault()
			evt.stopPropagation()
			props.onQuit()
		} else if (evt.name === "r") {
			evt.preventDefault()
			evt.stopPropagation()
			handleRetry()
		} else if (evt.name === "f" && canFix()) {
			evt.preventDefault()
			evt.stopPropagation()
			handleFix()
		} else if (evt.name === "j" || evt.name === "down") {
			evt.preventDefault()
			evt.stopPropagation()
			if (canFix()) {
				setSelectedAction((a) => (a === "fix" ? "retry" : "fix"))
			}
		} else if (evt.name === "k" || evt.name === "up") {
			evt.preventDefault()
			evt.stopPropagation()
			if (canFix()) {
				setSelectedAction((a) => (a === "fix" ? "retry" : "fix"))
			}
		} else if (evt.name === "return" || evt.name === "enter") {
			evt.preventDefault()
			evt.stopPropagation()
			if (selectedAction() === "fix" && canFix()) {
				handleFix()
			} else {
				handleRetry()
			}
		}
	})

	return (
		<box flexGrow={1} width="100%" height="100%">
			<WaveBackground peakColor={colors().error} peakOpacity={0.7} />
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
					width={70}
					paddingLeft={2}
					paddingRight={2}
					paddingTop={1}
					paddingBottom={1}
					gap={1}
				>
					<text fg={colors().error} attributes={TextAttributes.BOLD}>
						Error
					</text>
					<box flexDirection="column">
						<text fg={colors().error}>
							{attempts() > 1
								? `${parsedError().title} [${attempts()}]`
								: parsedError().title}
						</text>
					</box>

					<Show when={parsedError().hints.length > 0}>
						<box flexDirection="column">
							<For each={parsedError().hints}>
								{(hint) => (
									<text fg={colors().warning} wrapMode="word">
										{hint}
									</text>
								)}
							</For>
						</box>
					</Show>

					<Show when={parsedError().urls.length > 0}>
						<box flexDirection="column">
							<text fg={colors().textMuted}>More info:</text>
							<For each={parsedError().urls}>
								{(url) => (
									<text fg={colors().primary} wrapMode="none">
										{url}
									</text>
								)}
							</For>
						</box>
					</Show>

					<box flexDirection="column">
						<Show when={canFix()}>
							<box
								flexDirection="row"
								justifyContent="space-between"
								paddingLeft={1}
								paddingRight={1}
								backgroundColor={
									selectedAction() === "fix" && !isLoading()
										? colors().selectionBackground
										: undefined
								}
							>
								<text fg={isLoading() ? colors().textMuted : colors().text}>
									{isFixing() ? "Running..." : parsedError().fixCommand}
								</text>
								<text fg={colors().primary}>f</text>
							</box>
						</Show>

						<box
							flexDirection="row"
							justifyContent="space-between"
							paddingLeft={1}
							paddingRight={1}
							backgroundColor={
								selectedAction() === "retry" && !isLoading()
									? colors().selectionBackground
									: undefined
							}
						>
							<text fg={isLoading() ? colors().textMuted : colors().text}>
								{isRetrying() ? "Retrying..." : "retry"}
							</text>
							<text fg={colors().primary}>r</text>
						</box>
					</box>
					<FooterHints
						hints={[
							{ key: "enter", label: "run" },
							{ key: "q", label: "quit" },
						]}
					/>
				</box>
			</box>
		</box>
	)
}
