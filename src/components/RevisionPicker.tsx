import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createEffect, createSignal, onMount } from "solid-js"
import type { Commit } from "../commander/types"
import { useTheme } from "../context/theme"
import { AnsiText } from "./AnsiText"

export interface RevisionPickerProps {
	commits: Commit[]
	defaultRevision?: string
	selectedRevision?: string
	onSelect?: (commit: Commit) => void
	focused?: boolean
	height?: number
}

export function RevisionPicker(props: RevisionPickerProps) {
	const { colors } = useTheme()

	const findDefaultIndex = () => {
		if (props.defaultRevision) {
			const idx = props.commits.findIndex(
				(c) => c.changeId === props.defaultRevision,
			)
			return idx >= 0 ? idx : 0
		}
		return 0
	}

	const [selectedIndex, setSelectedIndex] = createSignal(findDefaultIndex())

	let scrollRef: ScrollBoxRenderable | undefined
	const [scrollTop, setScrollTop] = createSignal(0)

	const scrollToIndex = (index: number, force = false) => {
		const commitList = props.commits
		if (!scrollRef || commitList.length === 0) return

		let lineOffset = 0
		const clampedIndex = Math.min(index, commitList.length)
		for (const commit of commitList.slice(0, clampedIndex)) {
			lineOffset += commit.lines.length
		}

		const margin = 2
		const refAny = scrollRef as unknown as Record<string, unknown>
		const viewportHeight =
			(typeof refAny.height === "number" ? refAny.height : null) ??
			(typeof refAny.rows === "number" ? refAny.rows : null) ??
			10
		const currentScrollTop = scrollTop()

		if (force) {
			const targetScroll = Math.max(0, lineOffset - margin)
			scrollRef.scrollTo(targetScroll)
			setScrollTop(targetScroll)
			return
		}

		const visibleStart = currentScrollTop
		const visibleEnd = currentScrollTop + viewportHeight - 1
		const safeStart = visibleStart + margin
		const safeEnd = visibleEnd - margin

		let newScrollTop = currentScrollTop
		if (lineOffset < safeStart) {
			newScrollTop = Math.max(0, lineOffset - margin)
		} else if (lineOffset > safeEnd) {
			newScrollTop = Math.max(0, lineOffset - viewportHeight + margin + 1)
		}

		if (newScrollTop !== currentScrollTop) {
			scrollRef.scrollTo(newScrollTop)
			setScrollTop(newScrollTop)
		}
	}

	createEffect(() => {
		const _ = props.commits
		const __ = props.defaultRevision
		setSelectedIndex(findDefaultIndex())
	})

	onMount(() => {
		setTimeout(() => scrollToIndex(selectedIndex(), true), 1)
	})

	createEffect(() => {
		scrollToIndex(selectedIndex())
	})

	const selectPrev = () => {
		setSelectedIndex((i) => {
			const newIndex = Math.max(0, i - 1)
			const commit = props.commits[newIndex]
			if (commit) props.onSelect?.(commit)
			return newIndex
		})
	}

	const selectNext = () => {
		setSelectedIndex((i) => {
			const newIndex = Math.min(props.commits.length - 1, i + 1)
			const commit = props.commits[newIndex]
			if (commit) props.onSelect?.(commit)
			return newIndex
		})
	}

	useKeyboard((evt) => {
		if (!props.focused) return

		if (evt.name === "j" || evt.name === "down") {
			evt.preventDefault()
			selectNext()
		} else if (evt.name === "k" || evt.name === "up") {
			evt.preventDefault()
			selectPrev()
		}
	})

	createEffect(() => {
		const commit = props.commits[selectedIndex()]
		if (commit) props.onSelect?.(commit)
	})

	return (
		<Show
			when={props.commits.length > 0}
			fallback={<text fg={colors().textMuted}>No commits</text>}
		>
			<scrollbox
				ref={scrollRef}
				focused={props.focused}
				flexGrow={1}
				height={props.height}
				scrollbarOptions={{ visible: false }}
			>
				<For each={props.commits}>
					{(commit, index) => {
						const isSelected = () => index() === selectedIndex()
						return (
							<For each={commit.lines}>
								{(line) => (
									<box
										backgroundColor={
											isSelected() ? colors().selectionBackground : undefined
										}
										overflow="hidden"
									>
										<AnsiText
											content={line}
											bold={commit.isWorkingCopy}
											wrapMode="none"
										/>
									</box>
								)}
							</For>
						)
					}}
				</For>
			</scrollbox>
		</Show>
	)
}
