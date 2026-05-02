import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
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
import { FooterHints } from "./FooterHints"
import { WaveBackground } from "./WaveBackground"

interface GitRepoScreenProps {
	onInit: (colocate: boolean) => void
	onQuit: () => void
}

function GitRepoScreen(props: GitRepoScreenProps) {
	const { colors } = useTheme()
	const options = [
		{ key: "i", label: "jj git init", colocate: false },
		{ key: "c", label: "jj git init --colocate", colocate: true },
	]
	const [selectedIndex, setSelectedIndex] = createSignal(0)

	useKeyboard((evt) => {
		if (evt.name === "j" || evt.name === "down") {
			evt.preventDefault()
			evt.stopPropagation()
			setSelectedIndex((i) => Math.min(options.length - 1, i + 1))
		} else if (evt.name === "k" || evt.name === "up") {
			evt.preventDefault()
			evt.stopPropagation()
			setSelectedIndex((i) => Math.max(0, i - 1))
		} else if (evt.name === "return" || evt.name === "enter") {
			evt.preventDefault()
			evt.stopPropagation()
			const option = options[selectedIndex()]
			if (option) props.onInit(option.colocate)
		} else if (evt.name === "q") {
			evt.preventDefault()
			evt.stopPropagation()
			props.onQuit()
		} else if (evt.name && evt.name.length === 1) {
			const pressed = evt.name.toLowerCase()
			const option = options.find((option) => option.key === pressed)
			if (option) {
				evt.preventDefault()
				evt.stopPropagation()
				props.onInit(option.colocate)
			}
		}
	})

	return (
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
				<box flexDirection="column">
					<text fg={colors().warning}>Git repository detected</text>
					<text fg={colors().textMuted}>
						This directory has git, but has not been initialized for jj
					</text>
				</box>
				<box flexDirection="column">
					<For each={options}>
						{(option, index) => {
							const isSelected = () => index() === selectedIndex()
							const handleDoubleClick = createDoubleClickDetector(() =>
								props.onInit(option.colocate),
							)
							return (
								<box
									flexDirection="row"
									justifyContent="space-between"
									paddingLeft={1}
									paddingRight={1}
									backgroundColor={
										isSelected() ? colors().selectionBackground : undefined
									}
									onMouseDown={() => {
										setSelectedIndex(index())
										handleDoubleClick()
									}}
								>
									<text fg={colors().text}>{option.label}</text>
									<text fg={colors().primary}>{option.key}</text>
								</box>
							)
						}}
					</For>
				</box>
				<text fg={colors().textMuted}>
					Tip: --colocate keeps .git as the source of truth
				</text>
				<FooterHints
					hints={[
						{ key: "enter", label: "run" },
						{ key: "q", label: "quit" },
					]}
				/>
			</box>
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
	const { colors } = useTheme()
	const repoIndex = (index: number) => index + 1
	const [selectedIndex, setSelectedIndex] = createSignal(0)

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
		const index = selectedIndex() - 1
		if (index >= 0 && index < props.recentRepos.length) scrollToIndex(index)
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
		if (evt.name === "j" || evt.name === "down") {
			evt.preventDefault()
			evt.stopPropagation()
			setSelectedIndex((i) => Math.min(props.recentRepos.length, i + 1))
		} else if (evt.name === "k" || evt.name === "up") {
			evt.preventDefault()
			evt.stopPropagation()
			setSelectedIndex((i) => Math.max(0, i - 1))
		} else if (evt.name === "return" || evt.name === "enter") {
			evt.preventDefault()
			evt.stopPropagation()
			if (selectedIndex() === 0) {
				props.onInit()
			} else {
				const repo = props.recentRepos[selectedIndex() - 1]
				if (repo) props.onSelectRepo(repo.path)
			}
		} else if (evt.name === "i") {
			evt.preventDefault()
			evt.stopPropagation()
			props.onInit()
		} else if (evt.name === "q") {
			evt.preventDefault()
			evt.stopPropagation()
			props.onQuit()
		} else if (evt.name && /^[1-9]$/.test(evt.name)) {
			evt.preventDefault()
			evt.stopPropagation()
			const index = Number.parseInt(evt.name, 10) - 1
			const repo = props.recentRepos[index]
			if (repo) props.onSelectRepo(repo.path)
		}
	})

	const handleInitDoubleClick = createDoubleClickDetector(() => props.onInit())

	return (
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
				<box flexDirection="column">
					<text fg={colors().warning}>No repository found</text>
					<text fg={colors().textMuted}>
						This directory is not a jj or git repository
					</text>
				</box>
				<box
					flexDirection="row"
					justifyContent="space-between"
					paddingLeft={1}
					paddingRight={1}
					backgroundColor={
						selectedIndex() === 0 ? colors().selectionBackground : undefined
					}
					onMouseDown={() => {
						setSelectedIndex(0)
						handleInitDoubleClick()
					}}
				>
					<text fg={colors().text}>jj init</text>
					<text fg={colors().primary}>i</text>
				</box>
				<Show
					when={props.recentRepos.length > 0}
					fallback={<text fg={colors().textMuted}>No recent repositories</text>}
				>
					<box flexDirection="column">
						<text fg={colors().textMuted}>Recent repositories:</text>
						<box height={Math.min(props.recentRepos.length, 10)}>
							<scrollbox
								ref={scrollRef}
								flexGrow={1}
								scrollbarOptions={{ visible: false }}
							>
								<For each={props.recentRepos}>
									{(repo, index) => {
										const isSelected = () =>
											repoIndex(index()) === selectedIndex()
										const num = index() + 1
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
												justifyContent="space-between"
												paddingLeft={1}
												paddingRight={1}
												backgroundColor={
													isSelected()
														? colors().selectionBackground
														: undefined
												}
												onMouseDown={() => {
													setSelectedIndex(repoIndex(index()))
													handleDoubleClick()
												}}
											>
												<text fg={colors().primary} wrapMode="none">
													{num}.{" "}
												</text>
												<text wrapMode="none" fg={colors().text}>
													{displayPath}
												</text>
												<box flexGrow={1} />
												<text fg={colors().textMuted} wrapMode="none">
													{getTimestamp(repo.lastOpened)}
												</text>
											</box>
										)
									}}
								</For>
							</scrollbox>
						</box>
					</box>
				</Show>

				<FooterHints
					hints={[
						{ key: "enter", label: "run" },
						{ key: "q", label: "quit" },
					]}
				/>
			</box>
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
		<box flexGrow={1} width="100%" height="100%">
			{/* Wave background renders first (below content) */}
			<WaveBackground />
			{/* Content renders on top */}
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
		</box>
	)
}
