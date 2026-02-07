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
import {
	type Bookmark,
	fetchBookmarks,
	fetchBookmarksStream,
} from "../commander/bookmarks"
import { getRepoPath } from "../repo"
import { addRecentRepo } from "../utils/state"
import { getVisibleBookmarks } from "./sync-bookmarks"

import { fetchFiles } from "../commander/files"
import { streamLogPage } from "../commander/log"
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
import { readConfig } from "../config"
import {
	type FileTreeNode,
	type FlatFileNode,
	buildFileTree,
	flattenFlat,
	flattenTree,
} from "../utils/file-tree"
import { useFocus } from "./focus"
import { useLayout } from "./layout"

import { profile, profileMsg } from "../utils/profiler"

export type ViewMode = "log" | "files"

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
	loadMoreLog: () => Promise<void>
	logHasMore: () => boolean
	logLimit: () => number
	loading: () => boolean
	logLoadingMore: () => boolean
	error: () => string | null

	revsetFilter: () => string | null
	setRevsetFilter: (revset: string | null) => void
	revsetError: () => string | null
	clearRevsetFilter: () => void
	activeBookmarkFilter: () => string | null
	setActiveBookmarkFilter: (bookmark: string | null) => void
	previousRevsetFilter: () => string | null
	setPreviousRevsetFilter: (revset: string | null) => void
	clearBookmarkFilterState: () => void

	viewMode: () => ViewMode
	fileTree: () => FileTreeNode | null
	flatFiles: () => FlatFileNode[]
	selectedFileIndex: () => number
	setSelectedFileIndex: (index: number) => void
	collapsedPaths: () => Set<string>
	filesLoading: () => boolean
	filesError: () => string | null
	selectedFile: () => FlatFileNode | undefined

	showTree: () => boolean
	toggleShowTree: () => void
	enterFilesView: () => Promise<void>
	exitFilesView: () => void
	toggleFolder: (path: string) => void
	selectPrevFile: () => void
	selectNextFile: () => void
	selectFirstFile: () => void
	selectLastFile: () => void

	bookmarks: () => Bookmark[]
	remoteBookmarks: () => Bookmark[]
	remoteBookmarksLoading: () => boolean
	remoteBookmarksError: () => string | null
	visibleBookmarks: () => Bookmark[]
	bookmarkLimit: () => number
	loadMoreBookmarks: () => Promise<void>
	bookmarksHasMore: () => boolean
	bookmarksLoadingMore: () => boolean
	selectedBookmarkIndex: () => number
	setSelectedBookmarkIndex: (index: number) => void
	bookmarksLoading: () => boolean
	bookmarksError: () => string | null
	selectedBookmark: () => Bookmark | undefined
	loadBookmarks: () => Promise<void>
	loadRemoteBookmarks: () => Promise<void>
	selectPrevBookmark: () => void
	selectNextBookmark: () => void
	selectFirstBookmark: () => void
	selectLastBookmark: () => void
	jumpToBookmarkCommit: () => number | null

	refresh: () => Promise<void>
}

const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: { children: JSX.Element }) {
	const renderer = useRenderer()
	const focus = useFocus()
	const layout = useLayout()
	const [commits, setCommits] = createSignal<Commit[]>([])
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [logLimit, setLogLimit] = createSignal(50)
	const [logHasMore, setLogHasMore] = createSignal(true)
	const [logLoadingMore, setLogLoadingMore] = createSignal(false)

	const [viewMode, setViewMode] = createSignal<ViewMode>("log")
	const [files, setFiles] = createSignal<FileChange[]>([])
	const [fileTree, setFileTree] = createSignal<FileTreeNode | null>(null)
	const [selectedFileIndex, setSelectedFileIndexInternal] = createSignal(0)
	const [collapsedPaths, setCollapsedPaths] = createSignal<Set<string>>(
		new Set(),
	)
	const [filesLoading, setFilesLoading] = createSignal(false)
	const [filesError, setFilesError] = createSignal<string | null>(null)
	const [showTree, setShowTree] = createSignal(readConfig().files.showTree)

	const [bookmarks, setBookmarks] = createSignal<Bookmark[]>([])
	const [remoteBookmarks, setRemoteBookmarks] = createSignal<Bookmark[]>([])
	const [selectedBookmarkIndex, setSelectedBookmarkIndex] = createSignal(0)
	const [bookmarksLoading, setBookmarksLoading] = createSignal(false)
	const [bookmarksError, setBookmarksError] = createSignal<string | null>(null)
	const [remoteBookmarksLoading, setRemoteBookmarksLoading] =
		createSignal(false)
	const [remoteBookmarksError, setRemoteBookmarksError] = createSignal<
		string | null
	>(null)
	const [bookmarkLimit, setBookmarkLimit] = createSignal(100)
	const [bookmarksHasMore, setBookmarksHasMore] = createSignal(true)
	const [bookmarksLoadingMore, setBookmarksLoadingMore] = createSignal(false)
	const visibleBookmarks = createMemo(() =>
		getVisibleBookmarks(bookmarks(), bookmarkLimit()),
	)

	const [commitDetails, setCommitDetails] = createSignal<CommitDetails | null>(
		null,
	)
	const [refreshCounter, setRefreshCounter] = createSignal(0)

	const [revsetFilter, setRevsetFilterSignal] = createSignal<string | null>(
		null,
	)
	const [revsetError, setRevsetError] = createSignal<string | null>(null)
	const [activeBookmarkFilter, setActiveBookmarkFilterSignal] = createSignal<
		string | null
	>(null)
	const [previousRevsetFilter, setPreviousRevsetFilterSignal] = createSignal<
		string | null
	>(null)
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence
	const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "")
	const cleanRevsetError = (message: string) => {
		const stripped = stripAnsi(message)
		const firstLine =
			stripped.split("\n").find((line) => line.trim().length > 0) ?? stripped
		let cleaned = firstLine.trim()
		while (true) {
			const next = cleaned
				.replace(/^jj log failed:\s*/i, "")
				.replace(/^error:\s*/i, "")
				.replace(/^fatal:\s*/i, "")
				.trim()
			if (next === cleaned) break
			cleaned = next
		}
		return cleaned || stripped.trim() || "Failed to load log"
	}

	const setRevsetFilter = (revset: string | null) => {
		setRevsetFilterSignal(revset)
		setLogLimit(50)
		setLogHasMore(true)
		setLogLoadingMore(false)
	}

	const clearBookmarkFilterState = () => {
		setActiveBookmarkFilterSignal(null)
		setPreviousRevsetFilterSignal(null)
	}

	const flatFiles = createMemo(() => {
		const tree = fileTree()
		if (!tree) return []
		return showTree() ? flattenTree(tree, collapsedPaths()) : flattenFlat(tree)
	})

	const selectedFile = () => {
		const file = flatFiles()[selectedFileIndex()]
		return file?.node.isBinary ? undefined : file
	}

	const isSelectableFile = (file: FlatFileNode | undefined) =>
		Boolean(file) && !file?.node.isBinary

	const findFirstSelectableIndex = (files: FlatFileNode[]) => {
		for (let i = 0; i < files.length; i += 1) {
			if (isSelectableFile(files[i])) return i
		}
		return 0
	}

	const findLastSelectableIndex = (files: FlatFileNode[]) => {
		for (let i = files.length - 1; i >= 0; i -= 1) {
			if (isSelectableFile(files[i])) return i
		}
		return Math.max(0, files.length - 1)
	}

	const findSelectableIndex = (
		startIndex: number,
		direction: 1 | -1,
		files: FlatFileNode[],
	) => {
		for (let i = startIndex; i >= 0 && i < files.length; i += direction) {
			if (isSelectableFile(files[i])) return i
		}
		return null
	}

	const setSelectedFileIndex = (index: number) => {
		const files = flatFiles()
		if (!isSelectableFile(files[index])) return
		setSelectedFileIndexInternal(index)
	}

	createEffect(() => {
		const files = flatFiles()
		if (files.length === 0) return
		const current = selectedFileIndex()
		if (isSelectableFile(files[current])) return
		setSelectedFileIndexInternal(findFirstSelectableIndex(files))
	})

	let lastOpLogId: string | null = null
	let isRefreshing = false
	let refreshQueued = false
	let bookmarksStreamHandle: ReturnType<typeof fetchBookmarksStream> | null =
		null
	let logStreamHandle: { cancel: () => void } | null = null
	let logStreamToken = 0
	let logStreamResolve: (() => void) | null = null
	let logStreamReject: ((error: Error) => void) | null = null

	const cancelLogStream = () => {
		logStreamHandle?.cancel()
		logStreamHandle = null
		const resolve = logStreamResolve
		logStreamResolve = null
		logStreamReject = null
		resolve?.()
	}

	const doFullRefresh = async () => {
		if (isRefreshing) {
			refreshQueued = true
			return
		}
		isRefreshing = true
		setRefreshCounter((c) => c + 1)

		try {
			await Promise.all([loadLog(), loadBookmarks(), loadRemoteBookmarks()])
			const currentOpLogId = await fetchOpLogId()
			if (currentOpLogId) {
				lastOpLogId = currentOpLogId
			}

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
		} finally {
			isRefreshing = false
			if (refreshQueued) {
				refreshQueued = false
				doFullRefresh()
			}
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
			bookmarksStreamHandle?.cancel()
			cancelLogStream()
		})
	})

	createEffect(() => {
		const currentPanel = focus.panel()
		if (currentPanel === "log") {
			const mode = viewMode()
			focus.setActiveContext(mode === "files" ? "log.files" : "log.revisions")
		} else if (currentPanel === "refs") {
			focus.setActiveContext("refs.bookmarks")
		} else if (currentPanel === "detail") {
			focus.setActiveContext("detail")
		}
	})

	const activeCommit = () => selectedCommit()

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
		const files = flatFiles()
		const nextIndex = findSelectableIndex(selectedFileIndex() - 1, -1, files)
		if (nextIndex !== null) setSelectedFileIndexInternal(nextIndex)
	}

	const selectNextFile = () => {
		const files = flatFiles()
		const nextIndex = findSelectableIndex(selectedFileIndex() + 1, 1, files)
		if (nextIndex !== null) setSelectedFileIndexInternal(nextIndex)
	}

	const selectFirstFile = () => {
		const files = flatFiles()
		if (files.length === 0) return
		setSelectedFileIndexInternal(findFirstSelectableIndex(files))
	}

	const selectLastFile = () => {
		const files = flatFiles()
		if (files.length === 0) return
		setSelectedFileIndexInternal(findLastSelectableIndex(files))
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

	const loadBookmarks = (): Promise<void> => {
		bookmarksStreamHandle?.cancel()
		bookmarksStreamHandle = null

		const isInitialLoad = bookmarks().length === 0
		const previousBookmarks = bookmarks()
		if (isInitialLoad) {
			setBookmarksLoading(true)
			setBookmarks([])
		}
		setBookmarksError(null)

		const updateBookmarkState = (result: Bookmark[]) => {
			setBookmarks(result)
			const localCount = result.filter((bookmark) => bookmark.isLocal).length
			const limit = Math.min(bookmarkLimit(), localCount)
			setBookmarkLimit(limit)
			setBookmarksHasMore(localCount > limit)
		}

		return new Promise((resolve, reject) => {
			bookmarksStreamHandle = fetchBookmarksStream(
				{},
				{
					onBatch: (batch, _total) => {
						if (batch.length === 0) return
						if (
							previousBookmarks.length === 0 ||
							batch.length >= previousBookmarks.length
						) {
							updateBookmarkState(batch)
							return
						}
						const batchKeys = new Set(
							batch.map(
								(bookmark) =>
									`${bookmark.isLocal ? "local" : "remote"}:${bookmark.remote ?? ""}:${bookmark.name}`,
							),
						)
						const previousIndex = new Map<string, number>()
						for (const [index, bookmark] of previousBookmarks.entries()) {
							const key = `${bookmark.isLocal ? "local" : "remote"}:${bookmark.remote ?? ""}:${bookmark.name}`
							previousIndex.set(key, index)
						}
						const lastBatch = batch[batch.length - 1]
						const lastBatchKey = lastBatch
							? `${lastBatch.isLocal ? "local" : "remote"}:${lastBatch.remote ?? ""}:${lastBatch.name}`
							: null
						const lastBatchIndex = lastBatchKey
							? (previousIndex.get(lastBatchKey) ?? -1)
							: -1
						const merged = batch.concat(
							previousBookmarks.filter((bookmark) => {
								const key = `${bookmark.isLocal ? "local" : "remote"}:${bookmark.remote ?? ""}:${bookmark.name}`
								const index = previousIndex.get(key) ?? -1
								if (lastBatchIndex >= 0 && index <= lastBatchIndex) return false
								return !batchKeys.has(key)
							}),
						)
						updateBookmarkState(merged)
					},
					onComplete: (final) => {
						updateBookmarkState(final)
						if (isInitialLoad) {
							setSelectedBookmarkIndex(0)
						} else {
							setSelectedBookmarkIndex((index) =>
								final.length === 0 ? 0 : Math.min(index, final.length - 1),
							)
						}
						setBookmarksLoading(false)
						bookmarksStreamHandle = null
						resolve()
					},
					onError: (error) => {
						setBookmarksError(error.message)
						setBookmarksLoading(false)
						bookmarksStreamHandle = null
						reject(error)
					},
				},
			)
		})
	}

	const loadMoreBookmarks = async () => {
		if (!bookmarksHasMore() || bookmarksLoadingMore()) return
		setBookmarksLoadingMore(true)
		const newLimit = bookmarkLimit() + 100
		setBookmarkLimit(newLimit)
		try {
			const result = bookmarks()
			const localCount = result.filter((bookmark) => bookmark.isLocal).length
			const limit = Math.min(newLimit, localCount)
			setBookmarkLimit(limit)
			setBookmarksHasMore(localCount > limit)
			setSelectedBookmarkIndex((index) =>
				result.length === 0 ? 0 : Math.min(index, result.length - 1),
			)
		} catch (e) {
			setBookmarksError(
				e instanceof Error ? e.message : "Failed to load bookmarks",
			)
		} finally {
			setBookmarksLoadingMore(false)
		}
	}

	const loadRemoteBookmarks = async (): Promise<void> => {
		if (remoteBookmarksLoading()) return
		setRemoteBookmarksLoading(true)
		setRemoteBookmarksError(null)
		try {
			const result = await fetchBookmarks({ allRemotes: true })
			setRemoteBookmarks(result)
		} catch (e) {
			setRemoteBookmarksError(
				e instanceof Error ? e.message : "Failed to load remote bookmarks",
			)
		} finally {
			setRemoteBookmarksLoading(false)
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

	const loadMoreLog = async () => {
		if (!logHasMore() || logLoadingMore()) return
		cancelLogStream()
		setLogLoadingMore(true)
		const newLimit = logLimit() + 50
		setLogLimit(newLimit)
		const filter = revsetFilter()
		const minLength = commits().length
		const token = logStreamToken + 1
		logStreamToken = token
		return new Promise<void>((resolve, reject) => {
			logStreamResolve = resolve
			logStreamReject = reject
			logStreamHandle = streamLogPage(
				filter ? { revset: filter, limit: newLimit } : { limit: newLimit },
				{
					onBatch: (batch) => {
						if (token !== logStreamToken) return
						if (batch.length >= minLength) {
							setCommits(batch)
						}
					},
					onComplete: (result) => {
						if (token !== logStreamToken) return
						setCommits(result.commits)
						setLogHasMore(result.hasMore)
						setSelectedIndex((index) =>
							result.commits.length === 0
								? 0
								: Math.min(index, result.commits.length - 1),
						)
						setLogLoadingMore(false)
						logStreamHandle = null
						logStreamResolve = null
						logStreamReject = null
						resolve()
					},
					onError: (error) => {
						if (token !== logStreamToken) return
						const msg =
							error instanceof Error ? error.message : "Failed to load log"
						if (filter) {
							setRevsetError(cleanRevsetError(msg))
						} else {
							setError(msg)
						}
						setLogLoadingMore(false)
						logStreamHandle = null
						logStreamResolve = null
						logStreamReject = null
						resolve()
					},
				},
			)
		})
	}

	const loadLog = async () => {
		const isInitialLoad = commits().length === 0
		if (isInitialLoad) setLoading(true)
		setError(null)
		setRevsetError(null)
		const filter = revsetFilter()
		const limit = logLimit()
		const previousCommits = commits()
		const token = logStreamToken + 1
		logStreamToken = token
		cancelLogStream()
		return new Promise<void>((resolve, reject) => {
			logStreamResolve = resolve
			logStreamReject = reject
			logStreamHandle = streamLogPage(
				filter ? { revset: filter, limit } : { limit },
				{
					onBatch: (batch) => {
						if (token !== logStreamToken) return
						if (batch.length === 0) return
						const baseCommits = commits()
						if (
							baseCommits.length === 0 ||
							batch.length >= baseCommits.length
						) {
							setCommits(batch)
						} else {
							const batchIds = new Set(batch.map((commit) => commit.changeId))
							const batchHasWorkingCopy = batch.some(
								(commit) => commit.isWorkingCopy,
							)
							const merged = batch.concat(
								baseCommits.filter((commit) => {
									if (batchIds.has(commit.changeId)) return false
									if (batchHasWorkingCopy && commit.isWorkingCopy) return false
									return true
								}),
							)
							setCommits(merged)
						}
						if (isInitialLoad) setLoading(false)
					},
					onComplete: (result) => {
						if (token !== logStreamToken) return
						setCommits(result.commits)
						setLogHasMore(result.hasMore)
						setLogLimit(limit)
						setSelectedIndex((index) =>
							result.commits.length === 0
								? 0
								: Math.min(index, result.commits.length - 1),
						)
						setRevsetError(null)
						if (isInitialLoad) {
							setSelectedIndex(0)
							addRecentRepo(getRepoPath())
						}
						setLoading(false)
						logStreamHandle = null
						logStreamResolve = null
						logStreamReject = null
						resolve()
					},
					onError: (error) => {
						if (token !== logStreamToken) return
						const msg =
							error instanceof Error ? error.message : "Failed to load log"
						if (filter) {
							setRevsetError(cleanRevsetError(msg))
						} else {
							setError(msg)
						}
						if (isInitialLoad) setLoading(false)
						logStreamHandle = null
						logStreamResolve = null
						logStreamReject = null
						resolve()
					},
				},
			)
		})
	}

	const clearRevsetFilter = () => {
		setRevsetFilterSignal(null)
		setRevsetError(null)
		setLogLimit(50)
		setLogHasMore(true)
		setLogLoadingMore(false)
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
			const tree = buildFileTree(result)
			setFileTree(tree)
			const flatList = flattenTree(tree, new Set())
			setSelectedFileIndexInternal(findFirstSelectableIndex(flatList))
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
		loadMoreLog,
		logHasMore,
		logLimit,
		loading,
		logLoadingMore,
		error,

		revsetFilter,
		setRevsetFilter,
		revsetError,
		clearRevsetFilter,
		activeBookmarkFilter,
		setActiveBookmarkFilter: setActiveBookmarkFilterSignal,
		previousRevsetFilter,
		setPreviousRevsetFilter: setPreviousRevsetFilterSignal,
		clearBookmarkFilterState,

		viewMode,
		fileTree,
		flatFiles,
		selectedFileIndex,
		setSelectedFileIndex,
		collapsedPaths,
		filesLoading,
		filesError,
		selectedFile,

		showTree,
		toggleShowTree: () => setShowTree((v) => !v),
		enterFilesView,
		exitFilesView,
		toggleFolder,
		selectPrevFile,
		selectNextFile,
		selectFirstFile,
		selectLastFile,

		bookmarks,
		remoteBookmarks,
		remoteBookmarksLoading,
		remoteBookmarksError,
		visibleBookmarks,
		bookmarkLimit,
		loadMoreBookmarks,
		bookmarksHasMore,
		bookmarksLoadingMore,
		selectedBookmarkIndex,
		setSelectedBookmarkIndex,
		bookmarksLoading,
		bookmarksError,
		selectedBookmark,
		loadBookmarks,
		loadRemoteBookmarks,
		selectPrevBookmark,
		selectNextBookmark,
		selectFirstBookmark,
		selectLastBookmark,
		jumpToBookmarkCommit,

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
