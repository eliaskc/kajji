import { useRenderer } from "@opentui/solid"
import {
	type JSX,
	createContext,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
	useContext,
} from "solid-js"
import { type Bookmark, fetchBookmarks } from "../commander/bookmarks"
import { getRepoPath } from "../repo"
import { addRecentRepo } from "../utils/state"

import { fetchFiles } from "../commander/files"
import { fetchLog } from "../commander/log"
import {
	fetchOpLogId,
	jjAbandon,
	jjCommitDetails,
	jjDescribe,
	jjEdit,
	jjNew,
	jjSquash,
} from "../commander/operations"
import type { Commit, FileChange } from "../commander/types"
import {
	type FileTreeNode,
	type FlatFileNode,
	buildFileTree,
	flattenTree,
} from "../utils/file-tree"
import { useFocus } from "./focus"
import { useLayout } from "./layout"
import { useLoading } from "./loading"

import { profile, profileMsg } from "../utils/profiler"

export type ViewMode = "log" | "files"
export type BookmarkViewMode = "list" | "commits" | "files"

export interface CommitDetails {
	changeId: string
	subject: string
	body: string
}

interface SyncContextValue {
	commits: () => Commit[]
	selectedIndex: () => number
	setSelectedIndex: (index: number) => void
	selectPrev: () => void
	selectNext: () => void
	selectFirst: () => void
	selectLast: () => void
	selectedCommit: () => Commit | undefined
	activeCommit: () => Commit | undefined
	commitDetails: () => CommitDetails | null
	loadLog: () => Promise<void>
	loading: () => boolean
	error: () => string | null

	revsetFilter: () => string | null
	setRevsetFilter: (revset: string | null) => void
	revsetError: () => string | null
	clearRevsetFilter: () => void

	viewMode: () => ViewMode
	fileTree: () => FileTreeNode | null
	flatFiles: () => FlatFileNode[]
	selectedFileIndex: () => number
	setSelectedFileIndex: (index: number) => void
	collapsedPaths: () => Set<string>
	filesLoading: () => boolean
	filesError: () => string | null
	selectedFile: () => FlatFileNode | undefined

	enterFilesView: () => Promise<void>
	exitFilesView: () => void
	toggleFolder: (path: string) => void
	selectPrevFile: () => void
	selectNextFile: () => void
	selectFirstFile: () => void
	selectLastFile: () => void

	bookmarks: () => Bookmark[]
	selectedBookmarkIndex: () => number
	setSelectedBookmarkIndex: (index: number) => void
	bookmarksLoading: () => boolean
	bookmarksError: () => string | null
	selectedBookmark: () => Bookmark | undefined
	loadBookmarks: () => Promise<void>
	selectPrevBookmark: () => void
	selectNextBookmark: () => void
	selectFirstBookmark: () => void
	selectLastBookmark: () => void
	jumpToBookmarkCommit: () => number | null

	bookmarkViewMode: () => BookmarkViewMode
	bookmarkCommits: () => Commit[]
	selectedBookmarkCommitIndex: () => number
	setSelectedBookmarkCommitIndex: (index: number) => void
	bookmarkCommitsLoading: () => boolean
	selectedBookmarkCommit: () => Commit | undefined
	bookmarkFileTree: () => FileTreeNode | null
	bookmarkFlatFiles: () => FlatFileNode[]
	selectedBookmarkFileIndex: () => number
	setSelectedBookmarkFileIndex: (index: number) => void
	bookmarkFilesLoading: () => boolean
	selectedBookmarkFile: () => FlatFileNode | undefined
	bookmarkCollapsedPaths: () => Set<string>
	activeBookmarkName: () => string | null

	enterBookmarkCommitsView: () => Promise<void>
	enterBookmarkFilesView: () => Promise<void>
	exitBookmarkView: () => void
	selectPrevBookmarkCommit: () => void
	selectNextBookmarkCommit: () => void
	selectFirstBookmarkCommit: () => void
	selectLastBookmarkCommit: () => void
	selectPrevBookmarkFile: () => void
	selectNextBookmarkFile: () => void
	selectFirstBookmarkFile: () => void
	selectLastBookmarkFile: () => void
	toggleBookmarkFolder: (path: string) => void
	refresh: () => Promise<void>
}

const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: { children: JSX.Element }) {
	const renderer = useRenderer()
	const focus = useFocus()
	const layout = useLayout()
	const globalLoading = useLoading()
	const [commits, setCommits] = createSignal<Commit[]>([])
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

	const [viewMode, setViewMode] = createSignal<ViewMode>("log")
	const [files, setFiles] = createSignal<FileChange[]>([])
	const [fileTree, setFileTree] = createSignal<FileTreeNode | null>(null)
	const [selectedFileIndex, setSelectedFileIndex] = createSignal(0)
	const [collapsedPaths, setCollapsedPaths] = createSignal<Set<string>>(
		new Set(),
	)
	const [filesLoading, setFilesLoading] = createSignal(false)
	const [filesError, setFilesError] = createSignal<string | null>(null)

	const [bookmarks, setBookmarks] = createSignal<Bookmark[]>([])
	const [selectedBookmarkIndex, setSelectedBookmarkIndex] = createSignal(0)
	const [bookmarksLoading, setBookmarksLoading] = createSignal(false)
	const [bookmarksError, setBookmarksError] = createSignal<string | null>(null)

	const [bookmarkViewMode, setBookmarkViewMode] =
		createSignal<BookmarkViewMode>("list")
	const [bookmarkCommits, setBookmarkCommits] = createSignal<Commit[]>([])
	const [selectedBookmarkCommitIndex, setSelectedBookmarkCommitIndex] =
		createSignal(0)
	const [bookmarkCommitsLoading, setBookmarkCommitsLoading] =
		createSignal(false)
	const [activeBookmarkName, setActiveBookmarkName] = createSignal<
		string | null
	>(null)
	const [bookmarkFiles, setBookmarkFiles] = createSignal<FileChange[]>([])
	const [bookmarkFileTree, setBookmarkFileTree] =
		createSignal<FileTreeNode | null>(null)
	const [selectedBookmarkFileIndex, setSelectedBookmarkFileIndex] =
		createSignal(0)
	const [bookmarkCollapsedPaths, setBookmarkCollapsedPaths] = createSignal<
		Set<string>
	>(new Set())
	const [bookmarkFilesLoading, setBookmarkFilesLoading] = createSignal(false)

	const [commitDetails, setCommitDetails] = createSignal<CommitDetails | null>(
		null,
	)
	const [refreshCounter, setRefreshCounter] = createSignal(0)

	const [revsetFilter, setRevsetFilter] = createSignal<string | null>(null)
	const [revsetError, setRevsetError] = createSignal<string | null>(null)

	const flatFiles = createMemo(() => {
		const tree = fileTree()
		if (!tree) return []
		return flattenTree(tree, collapsedPaths())
	})

	const selectedFile = () => flatFiles()[selectedFileIndex()]

	const bookmarkFlatFiles = createMemo(() => {
		const tree = bookmarkFileTree()
		if (!tree) return []
		return flattenTree(tree, bookmarkCollapsedPaths())
	})

	const selectedBookmarkCommit = () =>
		bookmarkCommits()[selectedBookmarkCommitIndex()]
	const selectedBookmarkFile = () =>
		bookmarkFlatFiles()[selectedBookmarkFileIndex()]

	let lastOpLogId: string | null = null
	let isRefreshing = false

	const doFullRefresh = async () => {
		if (isRefreshing) return
		isRefreshing = true
		setRefreshCounter((c) => c + 1)

		try {
			await Promise.all([loadLog(), loadBookmarks()])

			if (viewMode() === "files") {
				const commit = selectedCommit()
				if (commit) {
					const result = await fetchFiles(commit.changeId, {
						ignoreWorkingCopy: true,
					})
					setFiles(result)
					setFileTree(buildFileTree(result))
				}
			}

			const bmMode = bookmarkViewMode()
			if (bmMode === "commits" || bmMode === "files") {
				const bookmarkName = activeBookmarkName()
				if (bookmarkName) {
					const result = await fetchLog({ revset: `::${bookmarkName}` })
					setBookmarkCommits(result)

					if (bmMode === "files") {
						const commit = selectedBookmarkCommit()
						if (commit) {
							const fileResult = await fetchFiles(commit.changeId, {
								ignoreWorkingCopy: true,
							})
							setBookmarkFiles(fileResult)
							setBookmarkFileTree(buildFileTree(fileResult))
						}
					}
				}
			}
		} finally {
			isRefreshing = false
		}
	}

	onMount(() => {
		let focusDebounceTimer: ReturnType<typeof setTimeout> | null = null
		let pollTimer: ReturnType<typeof setTimeout> | null = null
		let isChecking = false
		let isFocused = true

		const POLL_INTERVAL_FOCUSED = 2000
		const POLL_INTERVAL_UNFOCUSED = 30000
		const FOCUS_DEBOUNCE = 100

		const checkAndRefresh = async () => {
			if (isChecking) return
			isChecking = true

			try {
				const currentId = await fetchOpLogId()
				if (!currentId) return

				if (lastOpLogId !== null && currentId !== lastOpLogId) {
					lastOpLogId = currentId
					await doFullRefresh()
				} else {
					lastOpLogId = currentId
				}
			} catch (e) {
				// Propagate critical errors (like stale working copy)
				if (e instanceof Error) {
					setError(e.message)
				}
			} finally {
				isChecking = false
			}
		}

		const schedulePoll = () => {
			if (pollTimer) {
				clearTimeout(pollTimer)
			}
			const interval = isFocused
				? POLL_INTERVAL_FOCUSED
				: POLL_INTERVAL_UNFOCUSED
			pollTimer = setTimeout(() => {
				checkAndRefresh()
				schedulePoll()
			}, interval)
		}

		const handleFocus = () => {
			isFocused = true
			if (focusDebounceTimer) {
				clearTimeout(focusDebounceTimer)
			}
			focusDebounceTimer = setTimeout(() => {
				focusDebounceTimer = null
				checkAndRefresh()
			}, FOCUS_DEBOUNCE)
			schedulePoll()
		}

		const handleBlur = () => {
			isFocused = false
			schedulePoll()
		}

		renderer.on("focus", handleFocus)
		renderer.on("blur", handleBlur)

		fetchOpLogId()
			.then((id) => {
				lastOpLogId = id
			})
			.catch((e) => {
				// Propagate critical errors (like stale working copy)
				if (e instanceof Error) {
					setError(e.message)
				}
			})

		schedulePoll()

		onCleanup(() => {
			renderer.off("focus", handleFocus)
			renderer.off("blur", handleBlur)
			if (pollTimer) {
				clearTimeout(pollTimer)
			}
			if (focusDebounceTimer) {
				clearTimeout(focusDebounceTimer)
			}
		})
	})

	createEffect(() => {
		const currentPanel = focus.panel()
		if (currentPanel === "log") {
			const mode = viewMode()
			focus.setActiveContext(mode === "files" ? "log.files" : "log.revisions")
		} else if (currentPanel === "refs") {
			const mode = bookmarkViewMode()
			if (mode === "files") {
				focus.setActiveContext("refs.files")
			} else if (mode === "commits") {
				focus.setActiveContext("refs.revisions")
			} else {
				focus.setActiveContext("refs.bookmarks")
			}
		} else if (currentPanel === "detail") {
			focus.setActiveContext("detail")
		}
	})

	const activeCommit = () => {
		const focusedPanel = focus.panel()
		const bmMode = bookmarkViewMode()
		if (
			focusedPanel === "refs" &&
			(bmMode === "commits" || bmMode === "files")
		) {
			return selectedBookmarkCommit()
		}
		return selectedCommit()
	}

	let currentDetailsCacheKey: string | null = null
	createEffect(() => {
		const commit = activeCommit()

		if (!commit) {
			setCommitDetails(null)
			currentDetailsCacheKey = null
			return
		}

		const cacheKey = `${commit.changeId}:${commit.commitId}`
		if (cacheKey === currentDetailsCacheKey) return
		currentDetailsCacheKey = cacheKey

		const changeId = commit.changeId

		profileMsg(`--- select commit: ${changeId.slice(0, 8)}`)
		const endDetails = profile(`commitDetails(${changeId.slice(0, 8)})`)
		jjCommitDetails(changeId).then((details) => {
			endDetails()
			if (currentDetailsCacheKey === cacheKey) {
				setCommitDetails({
					changeId,
					subject: details.subject,
					body: details.body,
				})
			}
		})
	})

	const selectPrev = () => {
		setSelectedIndex((i) => Math.max(0, i - 1))
	}

	const selectNext = () => {
		setSelectedIndex((i) => Math.min(commits().length - 1, i + 1))
	}

	const selectFirst = () => {
		setSelectedIndex(0)
	}

	const selectLast = () => {
		setSelectedIndex(Math.max(0, commits().length - 1))
	}

	const selectedCommit = () => commits()[selectedIndex()]

	const selectPrevFile = () => {
		setSelectedFileIndex((i) => Math.max(0, i - 1))
	}

	const selectNextFile = () => {
		setSelectedFileIndex((i) => Math.min(flatFiles().length - 1, i + 1))
	}

	const selectFirstFile = () => {
		setSelectedFileIndex(0)
	}

	const selectLastFile = () => {
		setSelectedFileIndex(Math.max(0, flatFiles().length - 1))
	}

	const localBookmarks = () => bookmarks().filter((b) => b.isLocal)
	const selectedBookmark = () => localBookmarks()[selectedBookmarkIndex()]

	createEffect(() => {
		const maxIndex = localBookmarks().length - 1
		if (maxIndex >= 0 && selectedBookmarkIndex() > maxIndex) {
			setSelectedBookmarkIndex(maxIndex)
		}
	})

	const selectPrevBookmark = () => {
		setSelectedBookmarkIndex((i) => Math.max(0, i - 1))
	}

	const selectNextBookmark = () => {
		setSelectedBookmarkIndex((i) =>
			Math.min(localBookmarks().length - 1, i + 1),
		)
	}

	const selectFirstBookmark = () => {
		setSelectedBookmarkIndex(0)
	}

	const selectLastBookmark = () => {
		setSelectedBookmarkIndex(Math.max(0, localBookmarks().length - 1))
	}

	const selectPrevBookmarkCommit = () => {
		setSelectedBookmarkCommitIndex((i) => Math.max(0, i - 1))
	}

	const selectNextBookmarkCommit = () => {
		setSelectedBookmarkCommitIndex((i) =>
			Math.min(bookmarkCommits().length - 1, i + 1),
		)
	}

	const selectFirstBookmarkCommit = () => {
		setSelectedBookmarkCommitIndex(0)
	}

	const selectLastBookmarkCommit = () => {
		setSelectedBookmarkCommitIndex(Math.max(0, bookmarkCommits().length - 1))
	}

	const selectPrevBookmarkFile = () => {
		setSelectedBookmarkFileIndex((i) => Math.max(0, i - 1))
	}

	const selectNextBookmarkFile = () => {
		setSelectedBookmarkFileIndex((i) =>
			Math.min(bookmarkFlatFiles().length - 1, i + 1),
		)
	}

	const selectFirstBookmarkFile = () => {
		setSelectedBookmarkFileIndex(0)
	}

	const selectLastBookmarkFile = () => {
		setSelectedBookmarkFileIndex(Math.max(0, bookmarkFlatFiles().length - 1))
	}

	const toggleBookmarkFolder = (path: string) => {
		setBookmarkCollapsedPaths((prev) => {
			const next = new Set(prev)
			if (next.has(path)) {
				next.delete(path)
			} else {
				next.add(path)
			}
			return next
		})
	}

	const enterBookmarkCommitsView = async () => {
		const bookmark = selectedBookmark()
		if (!bookmark) return

		setBookmarkCommitsLoading(true)
		try {
			const result = await fetchLog({ revset: `::${bookmark.name}` })
			setBookmarkCommits(result)
			setSelectedBookmarkCommitIndex(0)
			setActiveBookmarkName(bookmark.name)
			setBookmarkViewMode("commits")
			focus.setActiveContext("refs.revisions")
		} catch (e) {
			console.error("Failed to load bookmark commits:", e)
		} finally {
			setBookmarkCommitsLoading(false)
		}
	}

	const enterBookmarkFilesView = async () => {
		const commit = selectedBookmarkCommit()
		if (!commit) return

		setBookmarkFilesLoading(true)
		try {
			const result = await fetchFiles(commit.changeId, {
				ignoreWorkingCopy: true,
			})
			setBookmarkFiles(result)
			setBookmarkFileTree(buildFileTree(result))
			setSelectedBookmarkFileIndex(0)
			setBookmarkCollapsedPaths(new Set<string>())
			setBookmarkViewMode("files")
			focus.setActiveContext("refs.files")
		} catch (e) {
			console.error("Failed to load bookmark files:", e)
		} finally {
			setBookmarkFilesLoading(false)
		}
	}

	const exitBookmarkView = () => {
		const mode = bookmarkViewMode()
		if (mode === "files") {
			setBookmarkViewMode("commits")
			setBookmarkFiles([])
			setBookmarkFileTree(null)
			setSelectedBookmarkFileIndex(0)
			setBookmarkCollapsedPaths(new Set<string>())
			focus.setActiveContext("refs.revisions")
		} else if (mode === "commits") {
			setBookmarkViewMode("list")
			setBookmarkCommits([])
			setSelectedBookmarkCommitIndex(0)
			setActiveBookmarkName(null)
			focus.setActiveContext("refs.bookmarks")
		}
	}

	const loadBookmarks = async () => {
		const isInitialLoad = bookmarks().length === 0
		if (isInitialLoad) setBookmarksLoading(true)
		setBookmarksError(null)
		try {
			await globalLoading.run("Fetching...", async () => {
				const result = await fetchBookmarks({ allRemotes: true })
				setBookmarks(result)
				if (isInitialLoad) setSelectedBookmarkIndex(0)
			})
		} catch (e) {
			setBookmarksError(
				e instanceof Error ? e.message : "Failed to load bookmarks",
			)
		} finally {
			if (isInitialLoad) setBookmarksLoading(false)
		}
	}

	const jumpToBookmarkCommit = (): number | null => {
		const bookmark = selectedBookmark()
		if (!bookmark) return null

		const index = commits().findIndex((c) => c.changeId === bookmark.changeId)
		if (index !== -1) {
			setSelectedIndex(index)
			return index
		}
		return null
	}

	const loadLog = async () => {
		const isInitialLoad = commits().length === 0
		if (isInitialLoad) setLoading(true)
		setError(null)
		setRevsetError(null)
		const filter = revsetFilter()
		try {
			await globalLoading.run("Fetching...", async () => {
				const result = await fetchLog(filter ? { revset: filter } : undefined)
				setCommits(result)
				setSelectedIndex((index) =>
					result.length === 0 ? 0 : Math.min(index, result.length - 1),
				)
				setRevsetError(null)
				if (isInitialLoad) {
					setSelectedIndex(0)
					addRecentRepo(getRepoPath())
				}
			})
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to load log"
			if (filter) {
				// Revset error - preserve commits, show revset-specific error
				// Strip prefixes like "jj log failed: Error: " to get clean message
				const firstLine =
					msg
						.split("\n")[0]
						?.replace(/^jj log failed:\s*/i, "")
						.replace(/^Error:\s*/i, "") || msg
				setRevsetError(firstLine)
			} else {
				setError(msg)
			}
		} finally {
			if (isInitialLoad) setLoading(false)
		}
	}

	const clearRevsetFilter = () => {
		setRevsetFilter(null)
		setRevsetError(null)
		loadLog()
	}

	const enterFilesView = async () => {
		const commit = selectedCommit()
		if (!commit) return

		setFilesLoading(true)
		setFilesError(null)
		try {
			const result = await fetchFiles(commit.changeId, {
				ignoreWorkingCopy: true,
			})
			setFiles(result)
			setFileTree(buildFileTree(result))
			setSelectedFileIndex(0)
			setCollapsedPaths(new Set<string>())
			setViewMode("files")
			focus.setActiveContext("log.files")
		} catch (e) {
			setFilesError(e instanceof Error ? e.message : "Failed to load files")
		} finally {
			setFilesLoading(false)
		}
	}

	const exitFilesView = () => {
		setViewMode("log")
		setFiles([])
		setFileTree(null)
		setSelectedFileIndex(0)
		setCollapsedPaths(new Set<string>())
		focus.setActiveContext("log.revisions")
	}

	const toggleFolder = (path: string) => {
		setCollapsedPaths((prev) => {
			const next = new Set(prev)
			if (next.has(path)) {
				next.delete(path)
			} else {
				next.add(path)
			}
			return next
		})
	}

	const value: SyncContextValue = {
		commits,
		selectedIndex,
		setSelectedIndex,
		selectPrev,
		selectNext,
		selectFirst,
		selectLast,
		selectedCommit,
		activeCommit,
		commitDetails,
		loadLog,
		loading,
		error,

		revsetFilter,
		setRevsetFilter,
		revsetError,
		clearRevsetFilter,

		viewMode,
		fileTree,
		flatFiles,
		selectedFileIndex,
		setSelectedFileIndex,
		collapsedPaths,
		filesLoading,
		filesError,
		selectedFile,

		enterFilesView,
		exitFilesView,
		toggleFolder,
		selectPrevFile,
		selectNextFile,
		selectFirstFile,
		selectLastFile,

		bookmarks,
		selectedBookmarkIndex,
		setSelectedBookmarkIndex,
		bookmarksLoading,
		bookmarksError,
		selectedBookmark,
		loadBookmarks,
		selectPrevBookmark,
		selectNextBookmark,
		selectFirstBookmark,
		selectLastBookmark,
		jumpToBookmarkCommit,

		bookmarkViewMode,
		bookmarkCommits,
		selectedBookmarkCommitIndex,
		setSelectedBookmarkCommitIndex,
		bookmarkCommitsLoading,
		selectedBookmarkCommit,
		bookmarkFileTree,
		bookmarkFlatFiles,
		selectedBookmarkFileIndex,
		setSelectedBookmarkFileIndex,
		bookmarkFilesLoading,
		selectedBookmarkFile,
		bookmarkCollapsedPaths,
		activeBookmarkName,

		enterBookmarkCommitsView,
		enterBookmarkFilesView,
		exitBookmarkView,
		selectPrevBookmarkCommit,
		selectNextBookmarkCommit,
		selectFirstBookmarkCommit,
		selectLastBookmarkCommit,
		selectPrevBookmarkFile,
		selectNextBookmarkFile,
		selectFirstBookmarkFile,
		selectLastBookmarkFile,
		toggleBookmarkFolder,
		refresh: doFullRefresh,
	}

	return (
		<SyncContext.Provider value={value}>{props.children}</SyncContext.Provider>
	)
}

export function useSync(): SyncContextValue {
	const ctx = useContext(SyncContext)
	if (!ctx) {
		throw new Error("useSync must be used within SyncProvider")
	}
	return ctx
}
