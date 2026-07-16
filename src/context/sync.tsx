import { useRenderer } from "@opentui/solid"
import {
    type JSX,
    batch as batchUpdates,
    createContext,
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
    onMount,
    useContext,
} from "solid-js"
import type { Bookmark } from "../commander/bookmarks"
import type { GitHubPullRequestSummary } from "../commander/github"
import { getRepoPath } from "../repo"
import { addRecentRepo } from "../utils/state"
import { getVisibleBookmarks } from "./sync-bookmarks"

import { type Commit, type FileChange, getRevisionId } from "../commander/types"
import { onConfigChange, readConfig } from "../config"
import {
    type FileLineStats,
    type FileTreeNode,
    type FlatFileNode,
    aggregateFileLineStats,
    buildFileTree,
    flattenFlat,
    flattenTree,
} from "../utils/file-tree"
import { useApplication } from "./application"
import { useFocus } from "./focus"
import { useLayout } from "./layout"

import { profile, profileMsg } from "../utils/profiler"

export type ViewMode = "log" | "files"

export interface BookmarkDiffView {
    bookmark: string
    from: string
    to: string
}

export interface CommitDetails {
    changeId: string
    subject: string
    body: string
}

interface RefreshOptions {
    selectIndex?: (commits: Commit[]) => number | null | undefined
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
    activeBookmarkDiff: () => BookmarkDiffView | null
    commitDetails: () => CommitDetails | null
    loadLog: (options?: RefreshOptions) => Promise<void>
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
    fileLineStats: () => ReadonlyMap<string, FileLineStats>
    setFileLineStats: (stats: ReadonlyMap<string, FileLineStats>) => void
    selectedFileIndex: () => number
    setSelectedFileIndex: (index: number) => void
    collapsedPaths: () => Set<string>
    filesLoading: () => boolean
    filesError: () => string | null
    selectedFile: () => FlatFileNode | undefined
    fileNavigationRequest: () => { id: number; path: string } | null
    setCurrentDiffFilePath: (path: string | null) => void

    showTree: () => boolean
    toggleShowTree: () => void
    enterFilesView: () => Promise<void>
    enterBookmarkDiffView: (bookmark: string) => Promise<void>
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
    pullRequestsByHead: () => ReadonlyMap<string, GitHubPullRequestSummary>
    bookmarkPrNumbers: () => ReadonlyMap<string, number>
    refreshPullRequestMetadata: () => void

    refresh: (options?: RefreshOptions) => Promise<void>
    refreshCounter: () => number
}

const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: { children: JSX.Element }) {
    const app = useApplication()
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
    const [rawFileLineStats, setFileLineStats] = createSignal<
        ReadonlyMap<string, FileLineStats>
    >(new Map())
    const fileLineStats = createMemo(() => {
        const tree = fileTree()
        return tree
            ? aggregateFileLineStats(tree, rawFileLineStats())
            : new Map<string, FileLineStats>()
    })
    const [selectedFileIndex, setSelectedFileIndexInternal] = createSignal(0)
    const [userCollapsedPaths, setUserCollapsedPaths] = createSignal<
        Set<string>
    >(new Set())
    const [currentDiffFilePath, setCurrentDiffFilePath] = createSignal<
        string | null
    >(null)
    const [fileNavigationRequest, setFileNavigationRequest] = createSignal<{
        id: number
        path: string
    } | null>(null)
    let fileNavigationRequestId = 0
    const [filesLoading, setFilesLoading] = createSignal(false)
    const [filesError, setFilesError] = createSignal<string | null>(null)
    let filesRequestId = 0
    let filesRequestKind: "commit" | "bookmark" | null = null
    const [showTree, setShowTree] = createSignal(readConfig().ui.showFileTree)
    const [activeBookmarkDiff, setActiveBookmarkDiff] =
        createSignal<BookmarkDiffView | null>(null)
    onMount(() => {
        const unsubscribeConfig = onConfigChange((config) => {
            setShowTree(config.ui.showFileTree)
        })
        onCleanup(unsubscribeConfig)
    })

    const [bookmarks, setBookmarks] = createSignal<Bookmark[]>([])
    const [remoteBookmarks, setRemoteBookmarks] = createSignal<Bookmark[]>([])
    const [selectedBookmarkIndex, setSelectedBookmarkIndex] = createSignal(0)
    const [bookmarksLoading, setBookmarksLoading] = createSignal(false)
    const [bookmarksError, setBookmarksError] = createSignal<string | null>(
        null,
    )
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
    const [pullRequestsByHead, setPullRequestsByHead] = createSignal<
        ReadonlyMap<string, GitHubPullRequestSummary>
    >(new Map())
    const bookmarkPrNumbers = createMemo(
        () =>
            new Map(
                [...pullRequestsByHead()].map(([head, pull]) => [
                    head,
                    pull.number,
                ]),
            ),
    )
    const [prMetadataRefreshToken, setPrMetadataRefreshToken] = createSignal(0)
    const refreshPullRequestMetadata = () => {
        setPrMetadataRefreshToken((token) => token + 1)
    }
    const prMetadataRefreshTimers: ReturnType<typeof setTimeout>[] = []
    const clearPrMetadataRefreshTimers = () => {
        for (const timer of prMetadataRefreshTimers) clearTimeout(timer)
        prMetadataRefreshTimers.length = 0
    }
    const refreshPullRequestMetadataSoon = () => {
        clearPrMetadataRefreshTimers()
        for (const delay of [15000, 30000, 60000]) {
            prMetadataRefreshTimers.push(
                setTimeout(refreshPullRequestMetadata, delay),
            )
        }
    }
    onCleanup(clearPrMetadataRefreshTimers)

    const [commitDetails, setCommitDetails] =
        createSignal<CommitDetails | null>(null)
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
            stripped.split("\n").find((line) => line.trim().length > 0) ??
            stripped
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

    const collapsedPaths = userCollapsedPaths

    const flatFiles = createMemo(() => {
        const tree = fileTree()
        if (!tree) return []
        return showTree()
            ? flattenTree(tree, collapsedPaths())
            : flattenFlat(tree)
    })

    const selectedFile = () => flatFiles()[selectedFileIndex()]

    const setSelectedFileIndex = (index: number) => {
        const files = flatFiles()
        if (index < 0 || index >= files.length) return
        setSelectedFileIndexInternal(index)
        const file = files[index]
        if (file && !file.node.isDirectory) {
            setFileNavigationRequest({
                id: ++fileNavigationRequestId,
                path: file.node.path,
            })
        }
    }

    createEffect(() => {
        const files = flatFiles()
        if (files.length === 0) return
        const current = selectedFileIndex()
        if (current >= 0 && current < files.length) return
        setSelectedFileIndexInternal(0)
    })

    createEffect(() => {
        if (viewMode() !== "files") return
        const path = currentDiffFilePath()
        if (!path) return
        const index = flatFiles().findIndex(
            (file) => !file.node.isDirectory && file.node.path === path,
        )
        if (index >= 0) setSelectedFileIndexInternal(index)
    })

    let lastOpLogId: string | null = null
    let lastWorkingCopyCommitId: string | null = null
    let isRefreshing = false
    let refreshQueued = false
    let bookmarksStreamHandle: { cancel: () => void } | null = null
    let bookmarksStreamToken = 0
    let logStreamHandle: { cancel: () => void } | null = null
    let logStreamToken = 0

    const cancelLogStream = () => {
        logStreamHandle?.cancel()
        logStreamHandle = null
    }

    const doFullRefresh = async (options?: RefreshOptions) => {
        if (isRefreshing) {
            refreshQueued = true
            return
        }
        isRefreshing = true
        setRefreshCounter((c) => c + 1)

        try {
            await Promise.all([
                loadLog(options),
                loadBookmarks(),
                loadRemoteBookmarks(),
            ])
            const refreshState = await app.jjRefreshState({
                cwd: getRepoPath(),
            })
            if (refreshState.operationId) {
                lastOpLogId = refreshState.operationId
            }
            if (refreshState.workingCopyCommitId) {
                lastWorkingCopyCommitId = refreshState.workingCopyCommitId
            }

            if (viewMode() === "files") {
                const diff = activeBookmarkDiff()
                const commit = selectedCommit()
                const request = ++filesRequestId
                filesRequestKind = diff ? "bookmark" : "commit"
                try {
                    const result = diff
                        ? await app.jjFiles(
                              { from: diff.from, to: diff.to },
                              { cwd: getRepoPath() },
                          )
                        : commit
                          ? await app.jjFiles(
                                { revision: getRevisionId(commit) },
                                { cwd: getRepoPath() },
                            )
                          : null
                    if (result && request === filesRequestId) {
                        setFiles(result)
                        setFileTree(buildFileTree(result))
                    }
                } finally {
                    if (request === filesRequestId) {
                        filesRequestKind = null
                        setFilesLoading(false)
                    }
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
        let disposed = false

        const POLL_INTERVAL_FOCUSED = 2000
        const POLL_INTERVAL_UNFOCUSED = 30000
        const FOCUS_DEBOUNCE = 100

        const checkAndRefresh = async () => {
            if (isChecking) return
            isChecking = true

            try {
                const refreshState = await app.jjRefreshState({
                    cwd: getRepoPath(),
                })
                if (
                    !refreshState.operationId &&
                    !refreshState.workingCopyCommitId
                ) {
                    return
                }

                const opChanged =
                    lastOpLogId !== null &&
                    refreshState.operationId !== lastOpLogId
                const workingCopyChanged =
                    lastWorkingCopyCommitId !== null &&
                    refreshState.workingCopyCommitId !== lastWorkingCopyCommitId

                if (opChanged || workingCopyChanged) {
                    lastOpLogId = refreshState.operationId || lastOpLogId
                    lastWorkingCopyCommitId =
                        refreshState.workingCopyCommitId ||
                        lastWorkingCopyCommitId
                    await doFullRefresh()
                } else {
                    lastOpLogId = refreshState.operationId
                    lastWorkingCopyCommitId = refreshState.workingCopyCommitId
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

        void (async () => {
            try {
                const state = await app.jjRefreshState({
                    cwd: getRepoPath(),
                })
                if (disposed) return
                lastOpLogId = state.operationId
                lastWorkingCopyCommitId = state.workingCopyCommitId
            } catch (e) {
                if (disposed) return
                // Propagate critical errors (like stale working copy)
                if (e instanceof Error) {
                    setError(e.message)
                }
            } finally {
                if (!disposed) {
                    schedulePoll()
                }
            }
        })()

        onCleanup(() => {
            disposed = true
            renderer.off("focus", handleFocus)
            renderer.off("blur", handleBlur)
            if (pollTimer) {
                clearTimeout(pollTimer)
            }
            if (focusDebounceTimer) {
                clearTimeout(focusDebounceTimer)
            }
            bookmarksStreamToken += 1
            logStreamToken += 1
            bookmarksStreamHandle?.cancel()
            cancelLogStream()
        })
    })

    createEffect(() => {
        const currentPanel = focus.panel()
        if (currentPanel === "log") {
            const mode = viewMode()
            focus.setActiveContext(
                mode === "files" ? "log.files" : "log.revisions",
            )
        } else if (currentPanel === "refs") {
            focus.setActiveContext("refs.bookmarks")
        }
    })

    const activeCommit = () => selectedCommit()

    let currentDetailsCacheKey: string | null = null
    createEffect(() => {
        const commit = activeCommit()

        if (activeBookmarkDiff()) {
            setCommitDetails(null)
            currentDetailsCacheKey = null
            return
        }

        if (!commit) {
            setCommitDetails(null)
            currentDetailsCacheKey = null
            return
        }

        const cacheKey = `${commit.changeId}:${commit.commitId}`
        if (cacheKey === currentDetailsCacheKey) return
        currentDetailsCacheKey = cacheKey

        const revId = getRevisionId(commit)

        profileMsg(`--- select commit: ${commit.changeId.slice(0, 8)}`)
        const endDetails = profile(
            `commitDetails(${commit.changeId.slice(0, 8)})`,
        )
        app.jjCommitDetails(revId, { cwd: getRepoPath() }).then((details) => {
            endDetails()
            if (currentDetailsCacheKey === cacheKey) {
                setCommitDetails({
                    changeId: commit.changeId,
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

    createEffect(
        on(
            () => {
                const commit = selectedCommit()
                return commit ? `${commit.changeId}:${commit.commitId}` : ""
            },
            async () => {
                if (activeBookmarkDiff()) return
                if (viewMode() !== "files") {
                    if (filesRequestKind === "commit") {
                        filesRequestId++
                        filesRequestKind = null
                        setFilesLoading(false)
                    }
                    return
                }
                const request = ++filesRequestId
                filesRequestKind = "commit"
                const commit = selectedCommit()
                if (!commit) {
                    setFilesLoading(false)
                    return
                }
                setFilesLoading(true)
                setFilesError(null)
                try {
                    const result = await app.jjFiles(
                        { revision: getRevisionId(commit) },
                        { cwd: getRepoPath() },
                    )
                    if (request !== filesRequestId) return
                    showFiles(result)
                    focus.setActiveContext("log.revisions")
                } catch (e) {
                    if (request !== filesRequestId) return
                    setFilesError(
                        e instanceof Error ? e.message : "Failed to load files",
                    )
                } finally {
                    if (request === filesRequestId) {
                        filesRequestKind = null
                        setFilesLoading(false)
                    }
                }
            },
            { defer: true },
        ),
    )

    const selectPrevFile = () => {
        setSelectedFileIndex(Math.max(0, selectedFileIndex() - 1))
    }

    const selectNextFile = () => {
        const files = flatFiles()
        setSelectedFileIndex(
            Math.min(files.length - 1, selectedFileIndex() + 1),
        )
    }

    const selectFirstFile = () => {
        const files = flatFiles()
        if (files.length === 0) return
        setSelectedFileIndex(0)
    }

    const selectLastFile = () => {
        const files = flatFiles()
        if (files.length === 0) return
        setSelectedFileIndex(files.length - 1)
    }

    const localBookmarks = () => bookmarks().filter((b) => b.isLocal)
    const selectedBookmark = () => localBookmarks()[selectedBookmarkIndex()]

    createEffect(() => {
        prMetadataRefreshToken()
        const names = localBookmarks()
            .filter((bookmark) => bookmark.changeId)
            .map((bookmark) => bookmark.name)
            .sort()
        if (names.length === 0) {
            setPullRequestsByHead(new Map())
            return
        }

        const controller = new AbortController()
        app.ghListPullRequestsByHead(names, {
            cwd: getRepoPath(),
            signal: controller.signal,
        })
            .then(setPullRequestsByHead)
            .catch(() => {
                if (!controller.signal.aborted) setPullRequestsByHead(new Map())
            })

        onCleanup(() => controller.abort())
    })

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

    const loadBookmarks = async (): Promise<void> => {
        const token = bookmarksStreamToken + 1
        bookmarksStreamToken = token
        bookmarksStreamHandle?.cancel()
        bookmarksStreamHandle = null

        const isInitialLoad = bookmarks().length === 0
        const previousBookmarks = bookmarks()
        if (isInitialLoad) {
            setBookmarksLoading(true)
            setBookmarks([])
        }
        setBookmarksError(null)

        const updateBookmarkState = (result: readonly Bookmark[]) => {
            setBookmarks(result.slice())
            const localCount = result.filter(
                (bookmark) => bookmark.isLocal,
            ).length
            setBookmarksHasMore(localCount > bookmarkLimit())
        }

        const stream = app.jjStreamBookmarks(
            { cwd: getRepoPath() },
            (batch) => {
                if (token !== bookmarksStreamToken || batch.length === 0) return
                if (
                    previousBookmarks.length === 0 ||
                    batch.length >= previousBookmarks.length
                ) {
                    updateBookmarkState(batch)
                    return
                }
                const bookmarkKey = (bookmark: Bookmark) =>
                    `${bookmark.isLocal ? "local" : "remote"}:${bookmark.remote ?? ""}:${bookmark.name}`
                const batchKeys = new Set(batch.map(bookmarkKey))
                const previousIndex = new Map<string, number>()
                for (const [index, bookmark] of previousBookmarks.entries()) {
                    previousIndex.set(bookmarkKey(bookmark), index)
                }
                const lastBatch = batch[batch.length - 1]
                const lastBatchIndex = lastBatch
                    ? (previousIndex.get(bookmarkKey(lastBatch)) ?? -1)
                    : -1
                const merged = batch.concat(
                    previousBookmarks.filter((bookmark) => {
                        const key = bookmarkKey(bookmark)
                        const index = previousIndex.get(key) ?? -1
                        if (lastBatchIndex >= 0 && index <= lastBatchIndex)
                            return false
                        return !batchKeys.has(key)
                    }),
                )
                updateBookmarkState(merged)
            },
        )
        bookmarksStreamHandle = stream

        try {
            const final = await stream.result
            if (token !== bookmarksStreamToken) return
            updateBookmarkState(final)
            if (isInitialLoad) {
                setSelectedBookmarkIndex(0)
            } else {
                setSelectedBookmarkIndex((index) =>
                    final.length === 0 ? 0 : Math.min(index, final.length - 1),
                )
            }
        } catch (error) {
            if (token !== bookmarksStreamToken) return
            setBookmarksError(
                error instanceof Error
                    ? error.message
                    : "Failed to load bookmarks",
            )
            throw error
        } finally {
            if (token === bookmarksStreamToken) {
                setBookmarksLoading(false)
                bookmarksStreamHandle = null
            }
        }
    }

    const loadMoreBookmarks = async () => {
        if (!bookmarksHasMore() || bookmarksLoadingMore()) return
        setBookmarksLoadingMore(true)
        const newLimit = bookmarkLimit() + 100
        setBookmarkLimit(newLimit)
        try {
            const result = bookmarks()
            const localCount = result.filter(
                (bookmark) => bookmark.isLocal,
            ).length
            setBookmarksHasMore(localCount > newLimit)
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
            const result = await app.jjBookmarks({
                cwd: getRepoPath(),
                allRemotes: true,
            })
            setRemoteBookmarks(result)
        } catch (e) {
            setRemoteBookmarksError(
                e instanceof Error
                    ? e.message
                    : "Failed to load remote bookmarks",
            )
        } finally {
            setRemoteBookmarksLoading(false)
        }
    }

    const jumpToBookmarkCommit = (): number | null => {
        const bookmark = selectedBookmark()
        if (!bookmark) return null

        const index = commits().findIndex(
            (c) => c.changeId === bookmark.changeId,
        )
        if (index !== -1) {
            setSelectedIndex(index)
            return index
        }

        return null
    }

    const loadMoreLog = async () => {
        if (!logHasMore() || logLoadingMore()) return
        const token = logStreamToken + 1
        logStreamToken = token
        cancelLogStream()
        setLogLoadingMore(true)
        const newLimit = logLimit() + 50
        setLogLimit(newLimit)
        const filter = revsetFilter()
        const minLength = commits().length
        const stream = app.jjStreamLogPage(
            filter
                ? { cwd: getRepoPath(), revset: filter, limit: newLimit }
                : { cwd: getRepoPath(), limit: newLimit },
            (batch) => {
                if (token !== logStreamToken) return
                if (batch.length >= minLength) setCommits(batch.slice())
            },
        )
        logStreamHandle = stream

        try {
            const result = await stream.result
            if (token !== logStreamToken) return
            setCommits(result.commits)
            setLogHasMore(result.hasMore)
            setSelectedIndex((index) =>
                result.commits.length === 0
                    ? 0
                    : Math.min(index, result.commits.length - 1),
            )
        } catch (error) {
            if (token !== logStreamToken) return
            const message =
                error instanceof Error ? error.message : "Failed to load log"
            if (filter) setRevsetError(cleanRevsetError(message))
            else setError(message)
        } finally {
            if (token === logStreamToken) {
                setLogLoadingMore(false)
                logStreamHandle = null
            }
        }
    }

    const loadLog = async (options?: RefreshOptions) => {
        const isInitialLoad = commits().length === 0
        if (isInitialLoad) setLoading(true)
        setError(null)
        setRevsetError(null)
        const filter = revsetFilter()
        const limit = logLimit()
        const token = logStreamToken + 1
        logStreamToken = token
        cancelLogStream()

        const stream = app.jjStreamLogPage(
            filter
                ? { cwd: getRepoPath(), revset: filter, limit }
                : { cwd: getRepoPath(), limit },
            (batch) => {
                if (token !== logStreamToken || batch.length === 0) return
                const baseCommits = commits()
                if (
                    baseCommits.length === 0 ||
                    batch.length >= baseCommits.length
                ) {
                    batchUpdates(() => {
                        setCommits(batch.slice())
                        const nextSelectedIndex = options?.selectIndex?.(
                            batch.slice(),
                        )
                        if (nextSelectedIndex != null)
                            setSelectedIndex(nextSelectedIndex)
                    })
                } else {
                    const batchIds = new Set(
                        batch.map((commit) => commit.changeId),
                    )
                    const batchHasWorkingCopy = batch.some(
                        (commit) => commit.isWorkingCopy,
                    )
                    const merged = batch.concat(
                        baseCommits.filter((commit) => {
                            if (batchIds.has(commit.changeId)) return false
                            if (batchHasWorkingCopy && commit.isWorkingCopy)
                                return false
                            return true
                        }),
                    )
                    batchUpdates(() => {
                        setCommits(merged)
                        const nextSelectedIndex = options?.selectIndex?.(merged)
                        if (nextSelectedIndex != null)
                            setSelectedIndex(nextSelectedIndex)
                    })
                }
                if (isInitialLoad) setLoading(false)
            },
        )
        logStreamHandle = stream

        try {
            const result = await stream.result
            if (token !== logStreamToken) return
            batchUpdates(() => {
                setCommits(result.commits)
                setLogHasMore(result.hasMore)
                setLogLimit(limit)
                const nextSelectedIndex = options?.selectIndex?.(result.commits)
                setSelectedIndex((index) =>
                    result.commits.length === 0
                        ? 0
                        : nextSelectedIndex != null
                          ? Math.max(
                                0,
                                Math.min(
                                    nextSelectedIndex,
                                    result.commits.length - 1,
                                ),
                            )
                          : Math.min(index, result.commits.length - 1),
                )
            })
            setRevsetError(null)
            if (isInitialLoad) {
                setSelectedIndex(0)
                addRecentRepo(getRepoPath())
            }
        } catch (error) {
            if (token !== logStreamToken) return
            const message =
                error instanceof Error ? error.message : "Failed to load log"
            if (filter) setRevsetError(cleanRevsetError(message))
            else setError(message)
        } finally {
            if (token === logStreamToken) {
                setLoading(false)
                logStreamHandle = null
            }
        }
    }

    const clearRevsetFilter = () => {
        setRevsetFilterSignal(null)
        setRevsetError(null)
        setLogLimit(50)
        setLogHasMore(true)
        setLogLoadingMore(false)
        loadLog()
    }

    const showFiles = (result: FileChange[]) => {
        setFiles(result)
        setFileTree(buildFileTree(result))
        setSelectedFileIndexInternal(0)
        setUserCollapsedPaths(new Set<string>())
        setViewMode("files")
    }

    const enterFilesView = async () => {
        const commit = selectedCommit()
        if (!commit) return

        setActiveBookmarkDiff(null)
        const request = ++filesRequestId
        filesRequestKind = "commit"
        const revisionId = getRevisionId(commit)
        setFilesLoading(true)
        setFilesError(null)
        try {
            const result = await app.jjFiles(
                { revision: revisionId },
                { cwd: getRepoPath() },
            )
            const currentCommit = selectedCommit()
            if (request !== filesRequestId) return
            if (!currentCommit || getRevisionId(currentCommit) !== revisionId)
                return
            showFiles(result)
            focus.setActiveContext("log.files")
        } catch (e) {
            if (request !== filesRequestId) return
            setFilesError(
                e instanceof Error ? e.message : "Failed to load files",
            )
        } finally {
            if (request === filesRequestId) {
                filesRequestKind = null
                setFilesLoading(false)
            }
        }
    }

    const enterBookmarkDiffView = async (bookmark: string) => {
        const diff = { bookmark, from: `${bookmark}@origin`, to: bookmark }
        const request = ++filesRequestId
        filesRequestKind = "bookmark"
        setFilesLoading(true)
        setFilesError(null)
        try {
            const result = await app.jjFiles(
                { from: diff.from, to: diff.to },
                { cwd: getRepoPath() },
            )
            if (request !== filesRequestId) return
            showFiles(result)
            setActiveBookmarkDiff(diff)
            focus.setPanel("log")
            focus.setActiveContext("log.files")
        } catch (e) {
            if (request !== filesRequestId) return
            setActiveBookmarkDiff(null)
            setFilesError(
                e instanceof Error ? e.message : "Failed to load files",
            )
        } finally {
            if (request === filesRequestId) {
                filesRequestKind = null
                setFilesLoading(false)
            }
        }
    }

    const exitFilesView = () => {
        filesRequestId++
        filesRequestKind = null
        setFilesLoading(false)
        setViewMode("log")
        setActiveBookmarkDiff(null)
        setFiles([])
        setFileTree(null)
        setSelectedFileIndex(0)
        setUserCollapsedPaths(new Set<string>())
        setCurrentDiffFilePath(null)
        setFileNavigationRequest(null)
        focus.setActiveContext("log.revisions")
    }

    const toggleFolder = (path: string) => {
        setUserCollapsedPaths((prev) => {
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
        activeBookmarkDiff,
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
        fileLineStats,
        setFileLineStats,
        selectedFileIndex,
        setSelectedFileIndex,
        collapsedPaths,
        filesLoading,
        filesError,
        selectedFile,
        fileNavigationRequest,
        setCurrentDiffFilePath,

        showTree,
        toggleShowTree: () => setShowTree((v) => !v),
        enterFilesView,
        enterBookmarkDiffView,
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
        pullRequestsByHead,
        bookmarkPrNumbers,
        refreshPullRequestMetadata: refreshPullRequestMetadataSoon,

        refresh: doFullRefresh,
        refreshCounter,
    }

    return (
        <SyncContext.Provider value={value}>
            {props.children}
        </SyncContext.Provider>
    )
}

export function useSync(): SyncContextValue {
    const ctx = useContext(SyncContext)
    if (!ctx) {
        throw new Error("useSync must be used within SyncProvider")
    }
    return ctx
}
