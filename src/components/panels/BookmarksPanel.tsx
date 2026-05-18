import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { Effect } from "effect"
import fuzzysort from "fuzzysort"
import {
    For,
    Show,
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
    onMount,
} from "solid-js"
import {
    type Bookmark,
    jjBookmarkCreate,
    jjBookmarkDelete,
    jjBookmarkForget,
    jjBookmarkRename,
    jjBookmarkSet,
} from "../../commander/bookmarks"
import { withCommandObserver } from "../../commander/executor"
import {
    type GitHubPullRequestSummary,
    ghBrowseCommit,
    ghListPullRequestsByHead,
    ghPrCreateWeb,
} from "../../commander/github"
import {
    type OperationResult,
    isImmutableError,
    jjEdit,
    jjGitPushBookmark,
    jjIsInTrunk,
    jjNew,
} from "../../commander/operations"
import { getRevisionId } from "../../commander/types"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { DIALOG_SIZE, useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useKeybind } from "../../context/keybind"
import { useStatus } from "../../context/status"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { buildBookmarkStackModel } from "../../stack/discovery"
import {
    applyStackPlan,
    prepareSubmitPlan,
    prepareSyncPlan,
} from "../../stack/executor"
import type { BookmarkStackModel, BookmarkStackRow } from "../../stack/model"
import { hasOriginDiff } from "../../utils/bookmark-origin-diff"
import { createDoubleClickDetector } from "../../utils/double-click"
import { FUZZY_THRESHOLD, scrollIntoView } from "../../utils/scroll"
import { BookmarkStackRowView } from "../BookmarkStackRowView"
import { FilterInput } from "../FilterInput"
import { Panel } from "../Panel"
import { ActionMenuModal } from "../modals/ActionMenuModal"
import { BookmarkNameModal } from "../modals/BookmarkNameModal"
import { RevisionPickerModal } from "../modals/RevisionPickerModal"
import { StackActionsModal } from "../modals/StackActionsModal"
import { StackPlanModal } from "../modals/StackPlanModal"
import { StackPreparingModal } from "../modals/StackPreparingModal"

type BookmarkRow = BookmarkStackRow<Bookmark>

export function BookmarksPanel() {
    const {
        commits,
        bookmarks,
        remoteBookmarks,
        remoteBookmarksLoading,
        remoteBookmarksError,
        visibleBookmarks,
        loadMoreBookmarks,
        bookmarksHasMore,
        bookmarksLoadingMore,
        selectedBookmarkIndex,
        setSelectedBookmarkIndex,
        selectedBookmark,
        bookmarksLoading,
        bookmarksError,
        selectNextBookmark,
        selectPrevBookmark,
        revsetFilter,
        setRevsetFilter,
        activeBookmarkFilter,
        setActiveBookmarkFilter,
        setPreviousRevsetFilter,
        loadLog,
        loadRemoteBookmarks,
        activeBookmarkDiff,
        enterBookmarkDiffView,
    } = useSync()
    const focus = useFocus()
    const command = useCommand()
    const keybind = useKeybind()
    const commandLog = useCommandLog()
    const dialog = useDialog()
    const status = useStatus()
    const { colors } = useTheme()
    const { refresh } = useSync()

    const runOperation = async (
        text: string,
        op: (options?: {
            observer: ReturnType<typeof commandLog.observer>
        }) => Promise<OperationResult>,
    ) => {
        const observer = commandLog.observer()
        const result = await withCommandObserver(observer, () =>
            op({ observer }),
        )
        commandLog.addEntry(result)
        if (result.success) {
            refresh()
        }
    }

    const openForBookmark = async (bookmark: Bookmark) => {
        if (!bookmark.changeId) {
            commandLog.addEntry({
                command: "open",
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: "Bookmark has no target change",
            })
            return
        }

        try {
            if (await jjIsInTrunk(bookmark.commitId)) {
                const observer = commandLog.observer()
                const browseResult = await ghBrowseCommit(bookmark.commitId, {
                    observer,
                })
                commandLog.addEntry(browseResult)
                return
            }
        } catch {
            // fall through to PR open
        }

        await loadRemoteBookmarks()

        let needsPush = false
        if (!remoteBookmarksLoading() && !remoteBookmarksError()) {
            needsPush = hasOriginDiff(bookmark, remoteBookmarks())
        }

        if (needsPush) {
            const observer = commandLog.observer()
            const pushResult = await jjGitPushBookmark(bookmark.name, {
                observer,
            })
            commandLog.addEntry(pushResult)
            if (!pushResult.success) return
            await refresh()
        }

        const observer = commandLog.observer()
        const prResult = await ghPrCreateWeb(bookmark.name, { observer })
        commandLog.addEntry(prResult)
        if (prResult.success) {
            refreshPrMetadataAfterPrCreateWeb()
        }
    }

    const isFocused = () => focus.isPanel("refs")
    const localBookmarks = () => bookmarks().filter((b) => b.isLocal)
    const activeLocalBookmarks = createMemo(() =>
        visibleBookmarks().filter((b) => b.isLocal && b.changeId),
    )
    const originChangedBookmarkNames = createMemo(() => {
        const originByName = new Map(
            remoteBookmarks()
                .filter(
                    (bookmark) =>
                        !bookmark.isLocal && bookmark.remote === "origin",
                )
                .map((bookmark) => [bookmark.name, bookmark]),
        )
        const names = new Set<string>()
        for (const bookmark of activeLocalBookmarks()) {
            const origin = originByName.get(bookmark.name)
            if (origin?.commitId && origin.commitId !== bookmark.commitId) {
                names.add(bookmark.name)
            }
        }
        return names
    })
    const deletedLocalBookmarks = createMemo(() =>
        visibleBookmarks().filter((b) => b.isLocal && !b.changeId),
    )
    const remoteOnlyBookmarks = createMemo(() => {
        const localNames = new Set(localBookmarks().map((b) => b.name))
        return remoteBookmarks().filter(
            (b) => !b.isLocal && !localNames.has(b.name),
        )
    })

    const visibleLocalBookmarks = createMemo(() => [
        ...activeLocalBookmarks(),
        ...deletedLocalBookmarks(),
    ])

    const [filterMode, setFilterModeInternal] = createSignal(false)
    const [filterQuery, setFilterQuery] = createSignal("")
    const [appliedFilter, setAppliedFilter] = createSignal("")
    const [filterSelectedIndex, setFilterSelectedIndex] = createSignal(0)
    const [showRemoteOnly, setShowRemoteOnly] = createSignal(false)
    const [remoteSelectedIndex, setRemoteSelectedIndex] = createSignal(0)
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
    const refreshPrMetadataAfterPrCreateWeb = () => {
        setTimeout(() => setPrMetadataRefreshToken((token) => token + 1), 15000)
        setTimeout(() => setPrMetadataRefreshToken((token) => token + 1), 30000)
        setTimeout(() => setPrMetadataRefreshToken((token) => token + 1), 60000)
    }
    const selectedBookmarkHasOriginDiff = createMemo(() => {
        if (showRemoteOnly()) return false
        const bookmark = selectedBookmark()
        return Boolean(
            bookmark && originChangedBookmarkNames().has(bookmark.name),
        )
    })

    let filterInputRef: TextareaRenderable | undefined

    const setFilterMode = (value: boolean) => {
        setFilterModeInternal(value)
        command.setInputMode(value)
    }

    onCleanup(() => {
        if (filterMode()) {
            command.setInputMode(false)
        }
    })

    const activeFilterQuery = createMemo(() =>
        filterMode() ? filterQuery() : appliedFilter(),
    )
    const hasActiveFilter = createMemo(
        () => activeFilterQuery().trim().length > 0,
    )

    createEffect(() => {
        prMetadataRefreshToken()
        const names = activeLocalBookmarks()
            .map((bookmark) => bookmark.name)
            .sort()
        if (names.length === 0) {
            setPullRequestsByHead(new Map())
            return
        }

        let cancelled = false
        ghListPullRequestsByHead(names)
            .then((pullsByHead) => {
                if (cancelled) return
                setPullRequestsByHead(pullsByHead)
            })
            .catch(() => {
                if (!cancelled) setPullRequestsByHead(new Map())
            })

        onCleanup(() => {
            cancelled = true
        })
    })

    const filteredBookmarks = createMemo(() => {
        const q = activeFilterQuery().trim()
        const source = showRemoteOnly()
            ? remoteOnlyBookmarks()
            : visibleLocalBookmarks()
        if (!q) return source

        const results = fuzzysort.go(q, source, {
            key: "name",
            threshold: FUZZY_THRESHOLD,
            limit: 100,
        })
        return results.map((r) => r.obj)
    })

    const displayBookmarks = createMemo(() => {
        if (hasActiveFilter()) return filteredBookmarks()
        if (showRemoteOnly()) return remoteOnlyBookmarks()
        return visibleLocalBookmarks()
    })

    const displayBookmarkStackModel = createMemo<
        BookmarkStackModel<Bookmark> | undefined
    >(() => {
        if (hasActiveFilter() || showRemoteOnly()) return undefined
        return Effect.runSync(
            buildBookmarkStackModel({
                commits: commits().map((commit) => ({
                    commitId: commit.commitId,
                    parentCommitIds: commit.parentCommitIds ?? [],
                    immutable: commit.immutable,
                })),
                bookmarks: displayBookmarks(),
            }),
        )
    })

    const displayBookmarkRows = createMemo<readonly BookmarkRow[]>(() => {
        const source = displayBookmarks()
        if (hasActiveFilter() || showRemoteOnly()) {
            return source.map((bookmark) => ({
                bookmark,
                depth: 0,
                stackKeys: [],
            }))
        }

        return displayBookmarkStackModel()?.rows ?? []
    })

    const currentBookmarks = () =>
        displayBookmarkRows().map((row) => row.bookmark)

    const listTotalRows = createMemo(() => displayBookmarkRows().length)
    const canPageBookmarks = createMemo(
        () => !showRemoteOnly() && !hasActiveFilter() && bookmarksHasMore(),
    )

    const displaySelectedIndex = createMemo(() => {
        if (hasActiveFilter()) return filterSelectedIndex()
        if (showRemoteOnly()) return remoteSelectedIndex()
        const selected = selectedBookmark()
        if (!selected) return 0
        const idx = currentBookmarks().findIndex(
            (b) => b.name === selected.name,
        )
        return idx >= 0 ? idx : 0
    })

    const currentSelectedIndex = () => displaySelectedIndex()
    const selectedBookmarkRow = createMemo(
        () => displayBookmarkRows()[currentSelectedIndex()],
    )
    const activeStackKey = createMemo(() => {
        if (!isFocused()) return undefined
        const row = selectedBookmarkRow()
        if (!row) return undefined
        if (
            commits().find(
                (commit) => commit.commitId === row.bookmark.commitId,
            )?.immutable
        ) {
            return undefined
        }
        return row.stackKeys[0]
    })

    const applyPreparedPlan = async (
        plan: Parameters<typeof applyStackPlan>[0],
    ) => {
        const observer = commandLog.observer()
        try {
            await Effect.runPromise(applyStackPlan(plan, { observer }))
            refresh()
            setPrMetadataRefreshToken((token) => token + 1)
        } catch (error) {
            commandLog.addEntry({
                command: plan.applyCommand,
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
            })
        }
    }

    const preparePlan = async (
        kind: "submit" | "sync",
        stackRootName: string,
        observer?: ReturnType<typeof commandLog.observer>,
    ) =>
        Effect.runPromise(
            kind === "submit"
                ? prepareSubmitPlan({ stackRootName, observer })
                : prepareSyncPlan({ stackRootName, observer }),
        )

    const openStackPlan = async (
        kind: "submit" | "sync",
        stackRootName: string,
    ) => {
        dialog.open(
            () => (
                <StackPreparingModal
                    kind={kind}
                    stackRootName={stackRootName}
                />
            ),
            {
                id: `bookmark-stack-${kind}-preparing`,
                title: [
                    {
                        text:
                            kind === "submit"
                                ? "Submit preview"
                                : "Sync preview",
                        style: "action",
                    },
                    " for ",
                    { text: stackRootName, style: "target" },
                ],
                ...DIALOG_SIZE.confirmWide,
                closeOnEsc: false,
                hints: [],
            },
        )
        try {
            const plan = await preparePlan(kind, stackRootName)
            dialog.close()
            dialog.open(
                () => (
                    <StackPlanModal
                        plan={plan}
                        onApply={() => applyPreparedPlan(plan)}
                        onBack={() => openStackActions(stackRootName)}
                    />
                ),
                {
                    id: `bookmark-stack-${kind}-plan`,
                    title: [
                        {
                            text:
                                kind === "submit"
                                    ? "Submit preview"
                                    : "Sync preview",
                            style: "action",
                        },
                        " for ",
                        { text: stackRootName, style: "target" },
                    ],
                    ...DIALOG_SIZE.confirmWide,
                    closeOnEsc: false,
                    hints: [
                        { key: "enter", label: "apply" },
                        { key: "esc", label: "back" },
                    ],
                },
            )
        } catch (error) {
            dialog.close()
            status.show(
                error instanceof Error ? error.message : String(error),
                {
                    kind: "error",
                },
            )
        }
    }

    const prepareAndApplyStack = async (
        kind: "submit" | "sync",
        stackRootName: string,
    ) => {
        const observer = commandLog.observer()
        try {
            const plan = await preparePlan(kind, stackRootName, observer)
            await applyPreparedPlan(plan)
        } catch (error) {
            commandLog.addEntry({
                command: kind === "submit" ? "stack submit" : "stack sync",
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
            })
        }
    }

    const stackActionOptions = (stackRootName: string) => [
        {
            key: "s",
            mutedPrefix: "stack ",
            label: "submit --dry-run",
            onSelect: () => openStackPlan("submit", stackRootName),
        },
        {
            key: "S",
            mutedPrefix: "stack ",
            label: "submit",
            onSelect: () => prepareAndApplyStack("submit", stackRootName),
        },
        {
            key: "f",
            mutedPrefix: "stack ",
            label: "sync --dry-run",
            onSelect: () => openStackPlan("sync", stackRootName),
        },
        {
            key: "F",
            mutedPrefix: "stack ",
            label: "sync",
            onSelect: () => prepareAndApplyStack("sync", stackRootName),
        },
    ]

    const stackRows = (stackRootName: string) => {
        const rows = displayBookmarkRows().filter((row) =>
            row.stackKeys.includes(stackRootName),
        )
        const minDepth = Math.min(...rows.map((row) => row.depth))
        return rows.map((row) => ({
            ...row,
            depth: Math.max(0, row.depth - minDepth),
        }))
    }

    const openStackActions = (stackRootName: string) => {
        dialog.open(
            () => (
                <StackActionsModal
                    stackRootName={stackRootName}
                    rows={stackRows(stackRootName)}
                    prNumbers={bookmarkPrNumbers()}
                    actions={stackActionOptions(stackRootName)}
                />
            ),
            {
                id: "bookmark-stack-actions",
                title: [
                    { text: "Stack", style: "action" },
                    " options for ",
                    { text: stackRootName, style: "target" },
                ],
                ...DIALOG_SIZE.confirmWide,
                hints: [
                    { key: "enter", label: "run" },
                    { key: "esc", label: "close" },
                ],
            },
        )
    }

    const openStackPicker = (stackRootNames: readonly string[]) => {
        dialog.open(
            () => (
                <ActionMenuModal
                    options={stackRootNames.map((name, index) => ({
                        key: String(index + 1),
                        label: name,
                        detail: bookmarkPrNumbers().get(name)
                            ? `#${bookmarkPrNumbers().get(name)}`
                            : undefined,
                        onSelect: () => openStackActions(name),
                    }))}
                />
            ),
            {
                id: "bookmark-stack-picker",
                title: [{ text: "Select stack", style: "action" }],
                ...DIALOG_SIZE.confirm,
                hints: [
                    { key: "enter", label: "select" },
                    { key: "esc", label: "close" },
                ],
            },
        )
    }

    const openSelectedStack = () => {
        if (showRemoteOnly()) return
        const row = selectedBookmarkRow()
        if (!row) return
        if (row.stackKeys.length === 0) {
            status.show(`No stack for ${row.bookmark.name}.`)
            return
        }
        const isTrunk = commits().find(
            (commit) => commit.commitId === row.bookmark.commitId,
        )?.immutable
        if (isTrunk) {
            openStackPicker(row.stackKeys)
            return
        }
        const stackKey = row.stackKeys[0]
        if (stackKey) openStackActions(stackKey)
    }

    createEffect(
        on(
            () => filterQuery(),
            () => {
                setFilterSelectedIndex(0)
            },
            { defer: true },
        ),
    )

    createEffect(
        on(
            () => [filteredBookmarks().length, filterSelectedIndex()] as const,
            ([len, idx]) => {
                if (!filterMode()) return
                if (len > 0 && idx >= len) {
                    setFilterSelectedIndex(len - 1)
                }
            },
            { defer: true },
        ),
    )

    createEffect(
        on(
            () =>
                [
                    hasActiveFilter(),
                    filteredBookmarks(),
                    filterSelectedIndex(),
                ] as const,
            ([active, filtered, idx]) => {
                if (!active) return
                if (showRemoteOnly()) return
                const selectedBookmarkItem = filtered[idx]
                if (!selectedBookmarkItem) return
                const originalIndex = localBookmarks().findIndex(
                    (b) => b.name === selectedBookmarkItem.name,
                )
                if (
                    originalIndex >= 0 &&
                    originalIndex !== selectedBookmarkIndex()
                ) {
                    setSelectedBookmarkIndex(originalIndex)
                }
            },
            { defer: true },
        ),
    )

    const selectNextBookmarkInView = () => {
        const max = currentBookmarks().length - 1
        if (max < 0) return
        if (hasActiveFilter()) {
            setFilterSelectedIndex((i) => Math.min(max, i + 1))
            return
        }
        if (showRemoteOnly()) {
            setRemoteSelectedIndex((i) => Math.min(max, i + 1))
            return
        }
        const nextIndex = Math.min(max, displaySelectedIndex() + 1)
        const nextBookmark = currentBookmarks()[nextIndex]
        if (!nextBookmark) return
        const localIndex = localBookmarks().findIndex(
            (b) => b.name === nextBookmark.name,
        )
        if (localIndex >= 0) {
            setSelectedBookmarkIndex(localIndex)
        }
    }

    const selectPrevBookmarkInView = () => {
        if (hasActiveFilter()) {
            setFilterSelectedIndex((i) => Math.max(0, i - 1))
            return
        }
        if (showRemoteOnly()) {
            setRemoteSelectedIndex((i) => Math.max(0, i - 1))
            return
        }
        const prevIndex = Math.max(0, displaySelectedIndex() - 1)
        const prevBookmark = currentBookmarks()[prevIndex]
        if (!prevBookmark) return
        const localIndex = localBookmarks().findIndex(
            (b) => b.name === prevBookmark.name,
        )
        if (localIndex >= 0) {
            setSelectedBookmarkIndex(localIndex)
        }
    }

    const activateBookmarkFilter = () => {
        setFilterQuery(appliedFilter())
        setFilterMode(true)
        setFilterSelectedIndex(currentSelectedIndex())
        queueMicrotask(() => {
            filterInputRef?.requestRender?.()
            filterInputRef?.focus()
            filterInputRef?.gotoBufferEnd()
        })
    }

    const cancelBookmarkFilter = () => {
        setFilterMode(false)
        setFilterQuery("")
        filterInputRef?.clear()
    }

    const clearBookmarkFilter = () => {
        setAppliedFilter("")
        setFilterMode(false)
        setFilterQuery("")
        filterInputRef?.clear()
    }

    const applyBookmarkFilter = () => {
        const nextQuery = filterQuery().trim()
        if (nextQuery) {
            setAppliedFilter(nextQuery)
            setFilterSelectedIndex(0)
        } else if (appliedFilter()) {
            setAppliedFilter("")
        }
        setFilterMode(false)
        setFilterQuery("")
        filterInputRef?.clear()
    }

    useKeyboard((evt) => {
        if (!isFocused()) return

        if (!filterMode() && hasActiveFilter() && evt.name === "escape") {
            evt.preventDefault()
            evt.stopPropagation()
            clearBookmarkFilter()
            return
        }

        if (!filterMode() && keybind.match("bookmark_toggle_remote", evt)) {
            evt.preventDefault()
            evt.stopPropagation()
            setShowRemoteOnly((prev) => !prev)
            setRemoteSelectedIndex(0)
            return
        }

        if (!filterMode() && keybind.match("search", evt)) {
            evt.preventDefault()
            evt.stopPropagation()
            activateBookmarkFilter()
            return
        }

        if (filterMode()) {
            if (evt.name === "escape") {
                evt.preventDefault()
                evt.stopPropagation()
                clearBookmarkFilter()
            } else if (evt.name === "down") {
                evt.preventDefault()
                evt.stopPropagation()
                const max = currentBookmarks().length - 1
                if (max >= 0) {
                    if (filterQuery().trim()) {
                        setFilterSelectedIndex((i) => Math.min(max, i + 1))
                    } else {
                        selectNextBookmarkInView()
                    }
                }
            } else if (evt.name === "up") {
                evt.preventDefault()
                evt.stopPropagation()
                if (filterQuery().trim()) {
                    setFilterSelectedIndex((i) => Math.max(0, i - 1))
                } else {
                    selectPrevBookmarkInView()
                }
            } else if (evt.name === "enter" || evt.name === "return") {
                evt.preventDefault()
                evt.stopPropagation()
                applyBookmarkFilter()
            }
        }
    })

    let listScrollRef: ScrollBoxRenderable | undefined

    const [listScrollTop, setListScrollTop] = createSignal(0)
    const [listViewportHeight, setListViewportHeight] = createSignal(30)
    const listThreshold = createMemo(() => {
        const buffer = Math.max(20, listViewportHeight() * 4)
        return Math.max(0, listTotalRows() - buffer)
    })

    createEffect(
        on(
            () => currentSelectedIndex(),
            (index) => {
                scrollIntoView({
                    ref: listScrollRef,
                    index,
                    currentScrollTop: listScrollTop(),
                    listLength: currentBookmarks().length,
                    setScrollTop: setListScrollTop,
                })
            },
        ),
    )

    onCleanup(() => {
        setListScrollTop(0)
        setListViewportHeight(30)
    })

    onMount(() => {
        const pollInterval = setInterval(() => {
            if (!listScrollRef) return
            const currentScroll = listScrollRef.scrollTop ?? 0
            const currentViewport = listScrollRef.viewport?.height ?? 30
            if (currentScroll !== listScrollTop()) {
                setListScrollTop(currentScroll)
            }
            if (currentViewport !== listViewportHeight()) {
                setListViewportHeight(currentViewport)
            }

            if (!bookmarksLoadingMore() && canPageBookmarks()) {
                if (currentScroll + currentViewport >= listThreshold()) {
                    loadMoreBookmarks()
                }
            }
        }, 100)
        onCleanup(() => clearInterval(pollInterval))
    })

    const title = () => (showRemoteOnly() ? "Bookmarks (Remote)" : "Bookmarks")
    const hasVisibleBookmarks = () =>
        showRemoteOnly()
            ? remoteOnlyBookmarks().length > 0
            : localBookmarks().length > 0

    const openSelectedBookmarkOriginDiff = () => {
        if (showRemoteOnly()) return
        const bookmark = selectedBookmark()
        if (!bookmark || !hasOriginDiff(bookmark, remoteBookmarks())) {
            status.show("No changes compared to origin.")
            return
        }
        const activeDiff = activeBookmarkDiff()
        if (activeDiff?.bookmark === bookmark.name) return
        void enterBookmarkDiffView(bookmark.name)
    }

    const handleListEnter = () => {
        if (showRemoteOnly()) return
        const bookmark = selectedBookmark()
        if (!bookmark) return
        setPreviousRevsetFilter(revsetFilter())
        setActiveBookmarkFilter(bookmark.name)
        setRevsetFilter(`::${bookmark.name}`)
        loadLog()
        focus.setActiveContext("log.revisions")
    }

    command.register(() => [
        {
            id: "refs.bookmarks.next",
            title: "down",
            keybind: "nav_down",
            context: "refs.bookmarks",
            type: "navigation",
            panel: "refs",
            visibility: "help-only",
            onSelect: selectNextBookmarkInView,
        },
        {
            id: "refs.bookmarks.prev",
            title: "up",
            keybind: "nav_up",
            context: "refs.bookmarks",
            type: "navigation",
            panel: "refs",
            visibility: "help-only",
            onSelect: selectPrevBookmarkInView,
        },
        {
            id: "refs.bookmarks.view_revisions",
            title: "view revisions",
            keybind: "enter",
            context: "refs.bookmarks",
            type: "view",
            panel: "refs",
            visibility: "help-only",
            onSelect: handleListEnter,
        },
        {
            id: "refs.bookmarks.open",
            title: "open",
            keybind: "open",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            onSelect: () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                openForBookmark(bookmark)
            },
        },
        {
            id: "refs.bookmarks.new",
            title: "new",
            keybind: "jj_new",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            onSelect: () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                if (!bookmark.changeId) {
                    commandLog.addEntry({
                        command: `jj new ${bookmark.name}`,
                        success: false,
                        exitCode: 1,
                        stdout: "",
                        stderr: "Bookmark has no target change",
                    })
                    return
                }
                runOperation("Creating...", (options) =>
                    jjNew(bookmark.name, options),
                )
            },
        },
        {
            id: "refs.bookmarks.edit",
            title: "edit",
            keybind: "jj_edit",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            onSelect: async () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                if (!bookmark.changeId) {
                    commandLog.addEntry({
                        command: `jj edit ${bookmark.name}`,
                        success: false,
                        exitCode: 1,
                        stdout: "",
                        stderr: "Bookmark has no target change",
                    })
                    return
                }
                const result = await jjEdit(bookmark.name)
                if (isImmutableError(result)) {
                    const confirmed = await dialog.confirm({
                        ...DIALOG_SIZE.confirm,
                        message: [
                            { text: bookmark.name, style: "target" },
                            " is immutable. ",
                            { text: "Edit", style: "action" },
                            " anyway?",
                        ],
                    })
                    if (confirmed) {
                        await runOperation("Editing...", () =>
                            jjEdit(bookmark.name, { ignoreImmutable: true }),
                        )
                    }
                } else {
                    commandLog.addEntry(result)
                    if (result.success) {
                        refresh()
                    }
                }
            },
        },
        {
            id: "refs.bookmarks.filter",
            title: "filter",
            keybind: "search",
            context: "refs.bookmarks",
            type: "view",
            panel: "refs",
            visibility: "help-only",
            onSelect: activateBookmarkFilter,
        },
        {
            id: "refs.bookmarks.toggle_remote",
            title: "remote-only",
            keybind: "bookmark_toggle_remote",
            context: "refs.bookmarks",
            type: "view",
            panel: "refs",
            visibility: "help-only",
            onSelect: () => {
                setShowRemoteOnly((prev) => !prev)
                setRemoteSelectedIndex(0)
            },
        },
        {
            id: "refs.bookmarks.create",
            title: "create",
            keybind: "bookmark_create",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            onSelect: () => {
                if (showRemoteOnly()) return
                const workingCopy = commits().find((c) => c.isWorkingCopy)
                dialog.open(
                    () => (
                        <BookmarkNameModal
                            commits={commits()}
                            defaultRevision={
                                workingCopy
                                    ? getRevisionId(workingCopy)
                                    : undefined
                            }
                            onSave={(name, revision) => {
                                runOperation("Creating bookmark...", () =>
                                    jjBookmarkCreate(name, { revision }),
                                )
                            }}
                        />
                    ),
                    {
                        id: "bookmark-create",
                        title: "Create Bookmark",
                        ...DIALOG_SIZE.form,
                        hints: [
                            { key: "tab", label: "switch field" },
                            { key: "enter", label: "save" },
                        ],
                    },
                )
            },
        },
        {
            id: "refs.bookmarks.delete",
            title: "delete",
            keybind: "bookmark_delete",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            onSelect: async () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                const currentIndex = selectedBookmarkIndex()
                const totalBookmarks = localBookmarks().length
                const confirmed = await dialog.confirm({
                    ...DIALOG_SIZE.confirm,
                    message: [
                        { text: "Delete", style: "action" },
                        " bookmark ",
                        { text: bookmark.name, style: "target" },
                        "?",
                    ],
                })
                if (confirmed) {
                    await runOperation("Deleting bookmark...", () =>
                        jjBookmarkDelete(bookmark.name),
                    )
                    if (
                        currentIndex >= totalBookmarks - 1 &&
                        currentIndex > 0
                    ) {
                        setSelectedBookmarkIndex(currentIndex - 1)
                    }
                }
            },
        },
        {
            id: "refs.bookmarks.rename",
            title: "rename",
            keybind: "bookmark_rename",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            onSelect: () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                dialog.open(
                    () => (
                        <BookmarkNameModal
                            initialValue={bookmark.name}
                            onSave={(newName) => {
                                runOperation("Renaming bookmark...", () =>
                                    jjBookmarkRename(bookmark.name, newName),
                                )
                            }}
                        />
                    ),
                    {
                        id: "bookmark-rename",
                        title: [
                            { text: "Rename", style: "action" },
                            " ",
                            { text: bookmark.name, style: "target" },
                        ],
                        ...DIALOG_SIZE.form,
                        hints: [{ key: "enter", label: "save" }],
                    },
                )
            },
        },
        {
            id: "refs.bookmarks.forget",
            title: "forget",
            keybind: "bookmark_forget",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            visibility: "help-only",
            onSelect: async () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                const confirmed = await dialog.confirm({
                    ...DIALOG_SIZE.confirm,
                    message: [
                        { text: "Forget", style: "action" },
                        " bookmark ",
                        { text: bookmark.name, style: "target" },
                        "? ",
                        { text: "(local only)", style: "muted" },
                    ],
                })
                if (confirmed) {
                    await runOperation("Forgetting bookmark...", () =>
                        jjBookmarkForget(bookmark.name),
                    )
                }
            },
        },
        {
            id: "refs.bookmarks.move",
            title: "move",
            keybind: "bookmark_move",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            visibility: "help-only",
            onSelect: () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                dialog.open(
                    () => (
                        <RevisionPickerModal
                            commits={commits()}
                            defaultRevision={bookmark.changeId}
                            onSelect={(revision) => {
                                runOperation("Moving bookmark...", () =>
                                    jjBookmarkSet(bookmark.name, revision),
                                )
                            }}
                        />
                    ),
                    {
                        id: "bookmark-move",
                        title: [
                            { text: "Move", style: "action" },
                            " ",
                            { text: bookmark.name, style: "target" },
                            " to",
                        ],
                        ...DIALOG_SIZE.form,
                        hints: [{ key: "enter", label: "confirm" }],
                    },
                )
            },
        },
        {
            id: "refs.bookmarks.stack",
            title: "stack",
            keybind: "bookmark_stack",
            context: "refs.bookmarks",
            type: "action",
            panel: "refs",
            onSelect: openSelectedStack,
        },
        {
            id: "refs.bookmarks.diff_origin",
            title: "compare to origin",
            keybind: "bookmark_diff_origin",
            context: "refs.bookmarks",
            type: "view",
            panel: "refs",
            visibility: selectedBookmarkHasOriginDiff()
                ? undefined
                : "help-only",
            onSelect: openSelectedBookmarkOriginDiff,
        },
    ])

    return (
        <Panel title={title()} hotkey="2" panelId="refs" focused={isFocused()}>
            <Show when={bookmarksError() && localBookmarks().length === 0}>
                <text fg={colors().error}>Error: {bookmarksError()}</text>
            </Show>
            <Show
                when={hasVisibleBookmarks()}
                fallback={
                    !bookmarksLoading() && !bookmarksError() ? (
                        <text fg={colors().textMuted}>
                            {showRemoteOnly()
                                ? "No remote-only bookmarks"
                                : "No bookmarks"}
                        </text>
                    ) : null
                }
            >
                <box
                    flexDirection="column"
                    flexGrow={1}
                    backgroundColor={colors().background}
                >
                    <Show
                        when={
                            currentBookmarks().length === 0 && hasActiveFilter()
                        }
                    >
                        <box flexGrow={1}>
                            <text fg={colors().textMuted}>
                                No matching bookmarks
                            </text>
                        </box>
                    </Show>

                    <Show when={currentBookmarks().length > 0}>
                        <scrollbox
                            ref={listScrollRef}
                            flexGrow={1}
                            backgroundColor={colors().background}
                            scrollbarOptions={{ visible: false }}
                            contentOptions={{
                                backgroundColor: colors().background,
                            }}
                        >
                            <For each={displayBookmarkRows()}>
                                {(row, index) => {
                                    const bookmark = row.bookmark
                                    const isSelected = () =>
                                        index() === currentSelectedIndex()
                                    const showSelection = () =>
                                        isSelected() && isFocused()
                                    const isActive = () =>
                                        activeBookmarkFilter() === bookmark.name
                                    const handleDoubleClick =
                                        createDoubleClickDetector(() => {
                                            handleListEnter()
                                        })
                                    const handleMouseDown = () => {
                                        if (hasActiveFilter()) {
                                            setFilterSelectedIndex(index())
                                        } else if (showRemoteOnly()) {
                                            setRemoteSelectedIndex(index())
                                        } else {
                                            const localIndex =
                                                localBookmarks().findIndex(
                                                    (b) =>
                                                        b.name ===
                                                        bookmark.name,
                                                )
                                            if (localIndex >= 0) {
                                                setSelectedBookmarkIndex(
                                                    localIndex,
                                                )
                                            }
                                        }
                                        handleDoubleClick()
                                    }
                                    const isDeleted = () => !bookmark.changeId
                                    const prNumber = () =>
                                        bookmarkPrNumbers().get(bookmark.name)
                                    const isInActiveStack = () =>
                                        Boolean(
                                            activeStackKey() &&
                                                row.stackKeys.includes(
                                                    activeStackKey() ?? "",
                                                ),
                                        )
                                    const isMutedByActiveStack = () =>
                                        Boolean(
                                            activeStackKey() &&
                                                !isInActiveStack(),
                                        )
                                    return (
                                        <>
                                            <box
                                                width="100%"
                                                height={1}
                                                flexShrink={0}
                                                backgroundColor={
                                                    showSelection()
                                                        ? colors()
                                                              .selectionBackground
                                                        : isActive()
                                                          ? colors()
                                                                .backgroundElement
                                                          : colors().background
                                                }
                                                overflow="hidden"
                                                onMouseDown={handleMouseDown}
                                                opacity={
                                                    isMutedByActiveStack()
                                                        ? 0.6
                                                        : 1
                                                }
                                            >
                                                <BookmarkStackRowView
                                                    row={row}
                                                    selected={showSelection()}
                                                    prNumber={prNumber()}
                                                    showOriginChanged={originChangedBookmarkNames().has(
                                                        bookmark.name,
                                                    )}
                                                    showRemote={showRemoteOnly()}
                                                />
                                            </box>
                                        </>
                                    )
                                }}
                            </For>
                        </scrollbox>
                    </Show>

                    <Show when={hasActiveFilter() || filterMode()}>
                        <Show
                            when={filterMode()}
                            fallback={
                                <>
                                    <box height={1} overflow="hidden">
                                        <text
                                            fg={colors().textMuted}
                                            wrapMode="none"
                                        >
                                            {"─".repeat(200)}
                                        </text>
                                    </box>
                                    <box height={1}>
                                        <text fg={colors().textMuted}>/</text>
                                        <text fg={colors().text}>
                                            {appliedFilter()}
                                        </text>
                                    </box>
                                </>
                            }
                        >
                            <FilterInput
                                ref={(r) => {
                                    filterInputRef = r
                                }}
                                onInput={setFilterQuery}
                                dividerPosition="above"
                                initialValue={appliedFilter()}
                            />
                        </Show>
                    </Show>
                </box>
            </Show>
        </Panel>
    )
}
