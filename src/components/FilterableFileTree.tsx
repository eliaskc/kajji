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
import { useDimmer } from "../context/dimmer"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { type Context, panelFromContext } from "../context/types"
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
	focusContext?: Context
	scrollRef?: (ref: ScrollBoxRenderable) => void
	filterApiRef?: (api: FilterableFileTreeApi) => void
}

export interface FilterableFileTreeApi {
	activateFilter: () => void
	applyFilter: () => void
	cancelFilter: () => void
	clearFilter: () => void
	selectNext: () => void
	selectPrev: () => void
	hasActiveFilter: () => boolean
	isFiltering: () => boolean
}

export function FilterableFileTree(props: FilterableFileTreeProps) {
	const { colors } = useTheme()
	const command = useCommand()
	const dimmer = useDimmer()
	const keybind = useKeybind()

	const [filterMode, setFilterModeInternal] = createSignal(false)

	const setFilterMode = (value: boolean) => {
		setFilterModeInternal(value)
		command.setInputMode(value)
	}

	onCleanup(() => {
		command.setInputMode(false)
		dimmer.clear(
			panelFromContext(props.focusContext ?? "log.files") ?? "log",
			"filter-files",
		)
	})

	createEffect(() => {
		const panel = panelFromContext(props.focusContext ?? "log.files") ?? "log"
		if (filterMode()) {
			dimmer.activate(panel, "filter-files", { keepVisible: ["detail"] })
		} else {
			dimmer.clear(panel, "filter-files")
		}
	})
	const [query, setQuery] = createSignal("")
	const [appliedQuery, setAppliedQuery] = createSignal("")
	const [filterSelectedIndex, setFilterSelectedIndex] = createSignal(0)
	const [scrollTop, setScrollTop] = createSignal(0)

	let inputRef: TextareaRenderable | undefined
	let scrollRef: ScrollBoxRenderable | undefined

	const activeQuery = createMemo(() =>
		filterMode() ? query() : appliedQuery(),
	)
	const hasActiveFilter = createMemo(() => activeQuery().trim().length > 0)

	const filteredFiles = createMemo(() => {
		const q = activeQuery().trim()
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
		hasActiveFilter() ? filterSelectedIndex() : props.selectedIndex()

	const currentFiles = () =>
		hasActiveFilter() ? filteredFiles() : props.files()

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
				if (!hasActiveFilter() && !filterMode()) return
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
				if (!hasActiveFilter()) return
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
		setQuery(appliedQuery())
		setFilterMode(true)
		setFilterSelectedIndex(currentSelectedIndex())
		queueMicrotask(() => {
			inputRef?.requestRender?.()
			inputRef?.focus()
			inputRef?.gotoBufferEnd()
		})
	}

	const cancelFilter = () => {
		setFilterMode(false)
		setQuery("")
		inputRef?.clear()
	}

	const applyFilter = () => {
		const nextQuery = query().trim()
		if (nextQuery) {
			setAppliedQuery(nextQuery)
			setFilterSelectedIndex(0)
		} else if (appliedQuery()) {
			setAppliedQuery("")
		}
		setFilterMode(false)
		setQuery("")
		inputRef?.clear()
	}

	const clearFilter = () => {
		setAppliedQuery("")
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
		if (hasActiveFilter()) {
			setFilterSelectedIndex((i) => Math.min(max, i + 1))
		} else {
			props.setSelectedIndex(Math.min(max, props.selectedIndex() + 1))
		}
	}

	const selectPrev = () => {
		if (hasActiveFilter()) {
			setFilterSelectedIndex((i) => Math.max(0, i - 1))
		} else {
			props.setSelectedIndex(Math.max(0, props.selectedIndex() - 1))
		}
	}

	props.filterApiRef?.({
		activateFilter,
		applyFilter,
		cancelFilter,
		clearFilter,
		selectNext,
		selectPrev,
		hasActiveFilter,
		isFiltering: filterMode,
	})

	useKeyboard((evt) => {
		if (!props.isFocused?.()) return

		if (!filterMode() && hasActiveFilter()) {
			if (keybind.match("nav_down", evt)) {
				evt.preventDefault()
				evt.stopPropagation()
				const max = currentFiles().length - 1
				if (max >= 0) {
					setFilterSelectedIndex((i) => Math.min(max, i + 1))
				}
				return
			}
			if (keybind.match("nav_up", evt)) {
				evt.preventDefault()
				evt.stopPropagation()
				setFilterSelectedIndex((i) => Math.max(0, i - 1))
				return
			}
		}

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
				applyFilter()
			}
		}
	})

	const handleSetSelectedIndex = (index: number) => {
		if (hasActiveFilter()) {
			setFilterSelectedIndex(index)
		} else {
			props.setSelectedIndex(index)
		}
	}

	const hasFiles = createMemo(() => currentFiles().length > 0)
	const noMatchesMessage = createMemo(() =>
		hasActiveFilter() ? "No matching files" : "No files",
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
						focusContext={props.focusContext}
					/>
				</scrollbox>
			</Show>

			{/* Filter input/display at bottom */}
			<Show when={hasActiveFilter() || filterMode()}>
				<Show
					when={filterMode()}
					fallback={
						<>
							<box height={1} overflow="hidden">
								<text fg={colors().textMuted} wrapMode="none">
									{"─".repeat(200)}
								</text>
							</box>
							<box paddingLeft={1} height={1}>
								<text fg={colors().textMuted}>/</text>
								<text fg={colors().text}>{appliedQuery()}</text>
							</box>
						</>
					}
				>
					<FilterInput
						ref={(r) => {
							inputRef = r
						}}
						onInput={setQuery}
						dividerPosition="above"
						initialValue={appliedQuery()}
					/>
				</Show>
			</Show>
		</box>
	)
}
