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
import { fetchDiff } from "../commander/diff"
import { fetchFiles } from "../commander/files"
import { fetchLog } from "../commander/log"
import type { Commit, FileChange } from "../commander/types"
import {
	type FileTreeNode,
	type FlatFileNode,
	buildFileTree,
	flattenTree,
	getFilePaths,
} from "../utils/file-tree"

export type ViewMode = "log" | "files"
export type BookmarkViewMode = "list" | "commits" | "files"

interface SyncContextValue {
	commits: () => Commit[]
	selectedIndex: () => number
	setSelectedIndex: (index: number) => void
	selectPrev: () => void
	selectNext: () => void
	selectFirst: () => void
	selectLast: () => void
	selectedCommit: () => Commit | undefined
	loadLog: () => Promise<void>
	loading: () => boolean
	error: () => string | null
	diff: () => string | null
	diffLoading: () => boolean
	diffError: () => string | null
	terminalWidth: () => number
	terminalHeight: () => number
	mainAreaWidth: () => number

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
	bookmarkCommitsLoading: () => boolean
	selectedBookmarkCommit: () => Commit | undefined
	bookmarkFileTree: () => FileTreeNode | null
	bookmarkFlatFiles: () => FlatFileNode[]
	selectedBookmarkFileIndex: () => number
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
}

const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: { children: JSX.Element }) {
	const renderer = useRenderer()
	const [commits, setCommits] = createSignal<Commit[]>([])
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [diff, setDiff] = createSignal<string | null>(null)
	const [diffLoading, setDiffLoading] = createSignal(false)
	const [diffError, setDiffError] = createSignal<string | null>(null)
	const [terminalWidth, setTerminalWidth] = createSignal(renderer.width)
	const [terminalHeight, setTerminalHeight] = createSignal(renderer.height)

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

	const mainAreaWidth = () => {
		const width = terminalWidth()
		const mainAreaRatio = 2 / 3
		const borderWidth = 2
		return Math.floor(width * mainAreaRatio) - borderWidth
	}

	onMount(() => {
		const handleResize = (width: number, height: number) => {
			setTerminalWidth(width)
			setTerminalHeight(height)
		}
		renderer.on("resize", handleResize)
		onCleanup(() => renderer.off("resize", handleResize))
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
		} else if (mode === "commits") {
			setBookmarkViewMode("list")
			setBookmarkCommits([])
			setSelectedBookmarkCommitIndex(0)
			setActiveBookmarkName(null)
		}
	}

	const loadBookmarks = async () => {
		setBookmarksLoading(true)
		setBookmarksError(null)
		try {
			const result = await fetchBookmarks({ allRemotes: true })
			setBookmarks(result)
			setSelectedBookmarkIndex(0)
		} catch (e) {
			setBookmarksError(
				e instanceof Error ? e.message : "Failed to load bookmarks",
			)
		} finally {
			setBookmarksLoading(false)
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

	let diffDebounceTimer: ReturnType<typeof setTimeout> | null = null
	let currentDiffKey: string | null = null

	const loadDiff = async (
		changeId: string,
		columns: number,
		paths?: string[],
	) => {
		const key = paths?.length ? `${changeId}:${paths.join(",")}` : changeId
		currentDiffKey = key
		setDiffLoading(true)
		setDiffError(null)
		try {
			const result = await fetchDiff(changeId, { columns, paths })
			if (currentDiffKey === key) {
				setDiff(result)
			}
		} catch (e) {
			if (currentDiffKey === key) {
				setDiffError(e instanceof Error ? e.message : "Failed to load diff")
				setDiff(null)
			}
		} finally {
			if (currentDiffKey === key) {
				setDiffLoading(false)
			}
		}
	}

	createEffect(() => {
		const columns = mainAreaWidth()
		const mode = viewMode()
		const bmMode = bookmarkViewMode()

		if (diffDebounceTimer) {
			clearTimeout(diffDebounceTimer)
		}

		if (bmMode === "commits") {
			const commit = selectedBookmarkCommit()
			if (!commit) return
			diffDebounceTimer = setTimeout(() => {
				loadDiff(commit.changeId, columns)
			}, 100)
		} else if (bmMode === "files") {
			const commit = selectedBookmarkCommit()
			const file = selectedBookmarkFile()
			if (!commit || !file) return
			const paths = file.node.isDirectory
				? getFilePaths(file.node)
				: [file.node.path]
			diffDebounceTimer = setTimeout(() => {
				loadDiff(commit.changeId, columns, paths)
			}, 100)
		} else if (mode === "files") {
			const commit = selectedCommit()
			const file = selectedFile()
			if (!commit || !file) return
			const paths = file.node.isDirectory
				? getFilePaths(file.node)
				: [file.node.path]
			diffDebounceTimer = setTimeout(() => {
				loadDiff(commit.changeId, columns, paths)
			}, 100)
		} else {
			const commit = selectedCommit()
			if (!commit) return
			diffDebounceTimer = setTimeout(() => {
				loadDiff(commit.changeId, columns)
			}, 100)
		}
	})

	const loadLog = async () => {
		setLoading(true)
		setError(null)
		try {
			const result = await fetchLog()
			setCommits(result)
			setSelectedIndex(0)
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load log")
		} finally {
			setLoading(false)
		}
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
		loadLog,
		loading,
		error,
		diff,
		diffLoading,
		diffError,
		terminalWidth,
		terminalHeight,
		mainAreaWidth,

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
		bookmarkCommitsLoading,
		selectedBookmarkCommit,
		bookmarkFileTree,
		bookmarkFlatFiles,
		selectedBookmarkFileIndex,
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
