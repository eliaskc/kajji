import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import {
	For,
	Show,
	createEffect,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js"
import { useTheme } from "../context/theme"
import { createDoubleClickDetector } from "../utils/double-click"
import type { RecentRepo } from "../utils/state"
import { formatRelativeTime } from "../utils/state"
import { BorderBox } from "./BorderBox"

function KeyHint(props: { keys: string; label: string; last?: boolean }) {
	const { colors, style } = useTheme()
	const separator = () => style().statusBar.separator

	return (
		<>
			<span style={{ fg: colors().primary }}>{props.keys}</span>{" "}
			<span style={{ fg: colors().textMuted }}>{props.label}</span>
			<Show when={!props.last}>
				<span style={{ fg: colors().textMuted }}>
					{separator() ? ` ${separator()} ` : "   "}
				</span>
			</Show>
		</>
	)
}

interface GitRepoScreenProps {
	onInit: (colocate: boolean) => void
	onQuit: () => void
}

function GitRepoScreen(props: GitRepoScreenProps) {
	const { colors, style } = useTheme()
	const options = [
		{ label: "jj git init", colocate: false },
		{ label: "jj git init --colocate", colocate: true },
	]
	const [selectedIndex, setSelectedIndex] = createSignal(0)

	useKeyboard((evt) => {
		if (evt.name === "j" || evt.name === "down") {
			evt.preventDefault()
			setSelectedIndex((i) => Math.min(options.length - 1, i + 1))
		} else if (evt.name === "k" || evt.name === "up") {
			evt.preventDefault()
			setSelectedIndex((i) => Math.max(0, i - 1))
		} else if (evt.name === "return" || evt.name === "enter") {
			evt.preventDefault()
			const option = options[selectedIndex()]
			if (option) props.onInit(option.colocate)
		} else if (evt.name === "q") {
			evt.preventDefault()
			props.onQuit()
		}
	})

	return (
		<box
			flexGrow={1}
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
			backgroundColor={colors().background}
		>
			{/* Message above modal */}
			<text fg={colors().warning}>Not a jj repository</text>
			<text fg={colors().textMuted}>
				Git repository detected in this directory
			</text>
			<box height={1} />

			<BorderBox
				border
				borderStyle={style().panel.borderStyle}
				borderColor={colors().borderFocused}
				backgroundColor={colors().background}
				width={50}
				topLeft={<text fg={colors().borderFocused}>Initialize jj</text>}
			>
				<box flexDirection="column" padding={1}>
					<For each={options}>
						{(option, index) => {
							const isSelected = () => index() === selectedIndex()
							const handleDoubleClick = createDoubleClickDetector(() =>
								props.onInit(option.colocate),
							)
							return (
								<box
									backgroundColor={
										isSelected() ? colors().selectionBackground : undefined
									}
									onMouseDown={() => {
										setSelectedIndex(index())
										handleDoubleClick()
									}}
								>
									<text>
										<span
											style={{
												fg: isSelected() ? colors().text : colors().textMuted,
											}}
										>
											{option.label}
										</span>
									</text>
								</box>
							)
						}}
					</For>
					<box height={1} />
					<text fg={colors().textMuted}>
						Tip: --colocate keeps .git as the source of truth
					</text>
				</box>
			</BorderBox>

			{/* Keybind hints */}
			<box height={1} />
			<text>
				<KeyHint keys="j/k" label="select" />
				<KeyHint keys="enter" label="run" />
				<KeyHint keys="q" label="quit" last />
			</text>
		</box>
	)
}

interface NoVcsScreenProps {
	recentRepos: RecentRepo[]
	onSelectRepo: (path: string) => void
	onInit: () => void
	onQuit: () => void
}

function NoVcsScreen(props: NoVcsScreenProps) {
	const { colors, style } = useTheme()
	type FocusedSection = "repos" | "init"
	const [focusedSection, setFocusedSection] = createSignal<FocusedSection>(
		props.recentRepos.length > 0 ? "repos" : "init",
	)
	const [selectedRepoIndex, setSelectedRepoIndex] = createSignal(0)

	// Scrolling for recent repos list
	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)

	const scrollToIndex = (index: number) => {
		if (!scrollRef || props.recentRepos.length === 0) return

		const margin = 1
		const refAny = scrollRef as unknown as Record<string, unknown>
		const viewportHeight =
			(typeof refAny.height === "number" ? refAny.height : null) ??
			(typeof refAny.rows === "number" ? refAny.rows : null) ??
			8
		const currentScrollTop = scrollTop()

		const visibleStart = currentScrollTop
		const visibleEnd = currentScrollTop + viewportHeight - 1
		const safeStart = visibleStart + margin
		const safeEnd = visibleEnd - margin

		let newScrollTop = currentScrollTop
		if (index < safeStart) {
			newScrollTop = Math.max(0, index - margin)
		} else if (index > safeEnd) {
			newScrollTop = Math.max(0, index - viewportHeight + margin + 1)
		}

		if (newScrollTop !== currentScrollTop) {
			scrollRef.scrollTo(newScrollTop)
			setScrollTop(newScrollTop)
		}
	}

	createEffect(() => {
		scrollToIndex(selectedRepoIndex())
	})

	// Trigger re-render of timestamps every 30 seconds
	const [timestampTick, setTimestampTick] = createSignal(0)
	onMount(() => {
		const interval = setInterval(() => setTimestampTick((t) => t + 1), 30000)
		onCleanup(() => clearInterval(interval))
	})

	// Helper that depends on tick to force re-render
	const getTimestamp = (isoDate: string) => {
		timestampTick() // Read signal to create dependency
		return formatRelativeTime(isoDate)
	}

	useKeyboard((evt) => {
		if (evt.name === "tab") {
			evt.preventDefault()
			if (props.recentRepos.length > 0) {
				setFocusedSection((s) => (s === "repos" ? "init" : "repos"))
			}
		} else if (evt.name === "j" || evt.name === "down") {
			evt.preventDefault()
			if (focusedSection() === "repos") {
				setSelectedRepoIndex((i) =>
					Math.min(props.recentRepos.length - 1, i + 1),
				)
			}
		} else if (evt.name === "k" || evt.name === "up") {
			evt.preventDefault()
			if (focusedSection() === "repos") {
				setSelectedRepoIndex((i) => Math.max(0, i - 1))
			}
		} else if (evt.name === "return" || evt.name === "enter") {
			evt.preventDefault()
			if (focusedSection() === "repos") {
				const repo = props.recentRepos[selectedRepoIndex()]
				if (repo) props.onSelectRepo(repo.path)
			} else {
				props.onInit()
			}
		} else if (evt.name === "q") {
			evt.preventDefault()
			props.onQuit()
		} else if (evt.name && /^[1-9]$/.test(evt.name)) {
			evt.preventDefault()
			const index = Number.parseInt(evt.name, 10) - 1
			const repo = props.recentRepos[index]
			if (repo) props.onSelectRepo(repo.path)
		}
	})

	const reposBorderColor = () =>
		focusedSection() === "repos" ? colors().borderFocused : colors().border
	const initBorderColor = () =>
		focusedSection() === "init" ? colors().borderFocused : colors().border

	const handleInitDoubleClick = createDoubleClickDetector(() => props.onInit())

	return (
		<box
			flexGrow={1}
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
			backgroundColor={colors().background}
		>
			{/* Message above modals */}
			<text fg={colors().warning}>Not a jj repository</text>
			<text fg={colors().textMuted}>
				No version control found in this directory
			</text>
			<box height={1} />

			<box flexDirection="column" width={60} gap={0}>
				{/* Recent repos section */}
				<BorderBox
					border
					borderStyle={style().panel.borderStyle}
					borderColor={reposBorderColor()}
					backgroundColor={colors().background}
					height={Math.min(props.recentRepos.length + 4, 14)}
					topLeft={<text fg={reposBorderColor()}>Recent repositories</text>}
					onMouseDown={() => setFocusedSection("repos")}
				>
					<Show
						when={props.recentRepos.length > 0}
						fallback={
							<box padding={1}>
								<text fg={colors().textMuted}>No recent repositories</text>
							</box>
						}
					>
						<scrollbox
							ref={scrollRef}
							flexGrow={1}
							paddingLeft={1}
							paddingRight={1}
							scrollbarOptions={{ visible: false }}
						>
							<For each={props.recentRepos}>
								{(repo, index) => {
									const isSelected = () =>
										focusedSection() === "repos" &&
										index() === selectedRepoIndex()
									const num = index() + 1
									// Shorten home directory
									const displayPath = repo.path.replace(
										new RegExp(`^${process.env.HOME}`),
										"~",
									)
									const handleDoubleClick = createDoubleClickDetector(() =>
										props.onSelectRepo(repo.path),
									)
									return (
										<box
											flexDirection="row"
											backgroundColor={
												isSelected() ? colors().selectionBackground : undefined
											}
											onMouseDown={() => {
												setFocusedSection("repos")
												setSelectedRepoIndex(index())
												handleDoubleClick()
											}}
										>
											<text wrapMode="none">
												<span
													style={{
														fg: isSelected()
															? colors().primary
															: colors().textMuted,
													}}
												>
													{num}.{" "}
												</span>
												<span
													style={{
														fg: isSelected()
															? colors().text
															: colors().textMuted,
													}}
												>
													{displayPath}
												</span>
											</text>
											<box flexGrow={1} />
											<text fg={colors().textMuted}>
												{getTimestamp(repo.lastOpened)}
											</text>
										</box>
									)
								}}
							</For>
						</scrollbox>
					</Show>
				</BorderBox>

				{/* Init section */}
				<BorderBox
					border
					borderStyle={style().panel.borderStyle}
					borderColor={initBorderColor()}
					backgroundColor={colors().background}
					height={3}
					topLeft={<text fg={initBorderColor()}>Initialize</text>}
					onMouseDown={() => setFocusedSection("init")}
				>
					<box paddingLeft={1} paddingRight={1}>
						<box
							backgroundColor={
								focusedSection() === "init"
									? colors().selectionBackground
									: undefined
							}
							onMouseDown={() => {
								setFocusedSection("init")
								handleInitDoubleClick()
							}}
						>
							<text>
								<span
									style={{
										fg:
											focusedSection() === "init"
												? colors().text
												: colors().textMuted,
									}}
								>
									jj init
								</span>
							</text>
						</box>
					</box>
				</BorderBox>
			</box>

			{/* Keybind hints */}
			<box height={1} />
			<text>
				<KeyHint keys="tab" label="switch" />
				<KeyHint keys="j/k" label="select" />
				<KeyHint keys="1-9" label="open" />
				<KeyHint keys="enter" label="run" />
				<KeyHint keys="q" label="quit" last />
			</text>
		</box>
	)
}

export interface StartupScreenProps {
	hasGitRepo: boolean
	recentRepos: RecentRepo[]
	onSelectRepo: (path: string) => void
	onInitJj: () => void
	onInitJjGit: (colocate: boolean) => void
	onQuit: () => void
}

export function StartupScreen(props: StartupScreenProps) {
	return (
		<Show
			when={props.hasGitRepo}
			fallback={
				<NoVcsScreen
					recentRepos={props.recentRepos}
					onSelectRepo={props.onSelectRepo}
					onInit={props.onInitJj}
					onQuit={props.onQuit}
				/>
			}
		>
			<GitRepoScreen onInit={props.onInitJjGit} onQuit={props.onQuit} />
		</Show>
	)
}
