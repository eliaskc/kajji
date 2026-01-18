import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import {
	Show,
	createEffect,
	createMemo,
	createSignal,
	on,
	onCleanup,
} from "solid-js"
import { useCommand } from "../context/command"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import type { FlatFileNode } from "../utils/file-tree"
import { FUZZY_THRESHOLD, scrollIntoView } from "../utils/scroll"
import { FileTreeList } from "./FileTreeList"
import { FilterInput } from "./FilterInput"

export interface FilterableFileTreeProps {
	files: () => FlatFileNode[]
	selectedIndex: () => number
	setSelectedIndex: (index: number) => void
	collapsedPaths: () => Set<string>
	toggleFolder: (path: string) => void
	isFocused?: () => boolean
	scrollRef?: (ref: ScrollBoxRenderable) => void
}

export function FilterableFileTree(props: FilterableFileTreeProps) {
	const { colors } = useTheme()
	const command = useCommand()
	const keybind = useKeybind()

	const [filterMode, setFilterModeInternal] = createSignal(false)

	const setFilterMode = (value: boolean) => {
		setFilterModeInternal(value)
		command.setInputMode(value)
	}

	onCleanup(() => {
		command.setInputMode(false)
	})
	const [query, setQuery] = createSignal("")
	const [filterSelectedIndex, setFilterSelectedIndex] = createSignal(0)
	const [scrollTop, setScrollTop] = createSignal(0)

	let inputRef: TextareaRenderable | undefined
	let scrollRef: ScrollBoxRenderable | undefined

	const filteredFiles = createMemo(() => {
		const q = query().trim()
		if (!q) return props.files()

		const allFiles = props.files()
		const results = fuzzysort.go(q, allFiles, {
			key: "node.path",
			threshold: FUZZY_THRESHOLD,
			limit: 100,
		})
		const matchingPaths = new Set(results.map((r) => r.obj.node.path))

		// Include parent folders so tree structure is preserved
		const pathsToShow = new Set<string>()
		for (const path of matchingPaths) {
			pathsToShow.add(path)
			const parts = path.split("/")
			for (let i = 1; i < parts.length; i++) {
				pathsToShow.add(parts.slice(0, i).join("/"))
			}
		}

		return allFiles.filter((item) => pathsToShow.has(item.node.path))
	})

	const currentSelectedIndex = () =>
		filterMode() && query().trim()
			? filterSelectedIndex()
			: props.selectedIndex()

	const currentFiles = () =>
		filterMode() && query().trim() ? filteredFiles() : props.files()

	createEffect(
		on(
			() => query(),
			() => {
				setFilterSelectedIndex(0)
			},
			{ defer: true },
		),
	)

	createEffect(
		on(
			() => [filteredFiles().length, filterSelectedIndex()] as const,
			([len, idx]) => {
				if (!filterMode()) return
				if (len > 0 && idx >= len) {
					setFilterSelectedIndex(len - 1)
				}
			},
			{ defer: true },
		),
	)

	// Sync filter selection back to parent so diff panel shows correct file
	createEffect(
		on(
			() => filterSelectedIndex(),
			(idx) => {
				if (!filterMode() || !query().trim()) return
				const filtered = filteredFiles()
				const selectedFile = filtered[idx]
				if (selectedFile) {
					const originalIndex = props
						.files()
						.findIndex((f) => f.node.path === selectedFile.node.path)
					if (originalIndex >= 0 && originalIndex !== props.selectedIndex()) {
						props.setSelectedIndex(originalIndex)
					}
				}
			},
			{ defer: true },
		),
	)

	const activateFilter = () => {
		setFilterMode(true)
		setFilterSelectedIndex(0)
		queueMicrotask(() => {
			inputRef?.requestRender?.()
			inputRef?.focus()
		})
	}

	const clearFilter = () => {
		setFilterMode(false)
		setQuery("")
		inputRef?.clear()
	}

	createEffect(() => {
		scrollIntoView({
			ref: scrollRef,
			index: currentSelectedIndex(),
			currentScrollTop: scrollTop(),
			listLength: currentFiles().length,
			setScrollTop,
		})
	})

	const selectNext = () => {
		const max = currentFiles().length - 1
		if (max < 0) return
		if (filterMode() && query().trim()) {
			setFilterSelectedIndex((i) => Math.min(max, i + 1))
		} else {
			props.setSelectedIndex(Math.min(max, props.selectedIndex() + 1))
		}
	}

	const selectPrev = () => {
		if (filterMode() && query().trim()) {
			setFilterSelectedIndex((i) => Math.max(0, i - 1))
		} else {
			props.setSelectedIndex(Math.max(0, props.selectedIndex() - 1))
		}
	}

	useKeyboard((evt) => {
		if (!props.isFocused?.()) return

		if (!filterMode() && keybind.match("search", evt)) {
			evt.preventDefault()
			evt.stopPropagation()
			activateFilter()
			return
		}

		if (filterMode()) {
			if (evt.name === "escape") {
				evt.preventDefault()
				evt.stopPropagation()
				clearFilter()
			} else if (evt.name === "down") {
				evt.preventDefault()
				evt.stopPropagation()
				selectNext()
			} else if (evt.name === "up") {
				evt.preventDefault()
				evt.stopPropagation()
				selectPrev()
			} else if (evt.name === "enter" || evt.name === "return") {
				evt.preventDefault()
				evt.stopPropagation()
				clearFilter()
			}
		}
	})

	const handleSetSelectedIndex = (index: number) => {
		if (filterMode() && query().trim()) {
			setFilterSelectedIndex(index)
		} else {
			props.setSelectedIndex(index)
		}
	}

	const hasFiles = createMemo(() => currentFiles().length > 0)
	const noMatchesMessage = createMemo(() =>
		filterMode() && query().trim() ? "No matching files" : "No files",
	)

	return (
		<box flexDirection="column" flexGrow={1}>
			{/* Empty state - outside scrollbox */}
			<Show when={!hasFiles()}>
				<box paddingLeft={1} flexGrow={1}>
					<text fg={colors().textMuted}>{noMatchesMessage()}</text>
				</box>
			</Show>

			{/* File list - only render scrollbox when we have files */}
			<Show when={hasFiles()}>
				<scrollbox
					ref={(r) => {
						scrollRef = r
						props.scrollRef?.(r)
					}}
					flexGrow={1}
					scrollbarOptions={{ visible: false }}
				>
					<FileTreeList
						files={currentFiles}
						selectedIndex={currentSelectedIndex}
						setSelectedIndex={handleSetSelectedIndex}
						collapsedPaths={props.collapsedPaths}
						toggleFolder={props.toggleFolder}
						isFocused={props.isFocused}
					/>
				</scrollbox>
			</Show>

			{/* Filter input at bottom */}
			<Show when={filterMode()}>
				<FilterInput
					ref={(r) => {
						inputRef = r
					}}
					onInput={setQuery}
					dividerPosition="above"
				/>
			</Show>
		</box>
	)
}
