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
import type { Bookmark } from "../../commander/bookmarks"
import {
    type OperationResult,
    isImmutableError,
} from "../../commander/operations"
import { getRevisionId } from "../../commander/types"
import { useApplication } from "../../context/application"
import { useCommand } from "../../context/command"
import { useCommandLog } from "../../context/commandlog"
import { DIALOG_SIZE, useDialog } from "../../context/dialog"
import { useFocus } from "../../context/focus"
import { useKeybind } from "../../context/keybind"
import { useStatus } from "../../context/status"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { featureFlags } from "../../feature-flags"
import { createHorizontalCropScroll } from "../../hooks/horizontal-crop-scroll"
import { getRepoPath } from "../../repo"
import { buildBookmarkStackModel } from "../../stack/discovery"
import type {
    BookmarkStackModel,
    BookmarkStackRow,
    StackPlan,
} from "../../stack/model"
import { resolveAnsiForeground } from "../../theme/ansi"
import { getVisibleWidth } from "../../utils/ansi"
import { hasOriginDiff } from "../../utils/bookmark-origin-diff"
import { createDoubleClickDetector } from "../../utils/double-click"
import {
    FUZZY_THRESHOLD,
    type SelectionSource,
    scrollIntoView,
} from "../../utils/scroll"
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
    const app = useApplication()
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
        pullRequestsByHead,
        bookmarkPrNumbers,
        refreshPullRequestMetadata,
    } = useSync()
    const focus = useFocus()
    const command = useCommand()
    const keybind = useKeybind()
    const commandLog = useCommandLog()
    const dialog = useDialog()
    const status = useStatus()
    const { colors } = useTheme()
    const { refresh } = useSync()
    const githubStackingEnabled = featureFlags.githubStacking

    const runOperation = async (
        text: string,
        op: (
            observer: ReturnType<typeof commandLog.observer>,
        ) => Promise<OperationResult>,
    ) => {
        const observer = commandLog.observer()
        const result = await op(observer)
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
            if (
                await app.jjIsInTrunk(bookmark.commitId, {
                    cwd: getRepoPath(),
                })
            ) {
                const observer = commandLog.observer()
                const browseResult = await app.ghBrowseCommit(
                    bookmark.commitId,
                    {
                        cwd: getRepoPath(),
                        observer,
                    },
                )
                commandLog.addEntry(browseResult)
                return
            }
        } catch {
            // fall through to PR open
        }

        const knownPrNumber = bookmarkPrNumbers().get(bookmark.name)
        if (knownPrNumber) {
            const observer = commandLog.observer()
            const viewResult = await app.ghPrViewWeb(knownPrNumber, {
                cwd: getRepoPath(),
                observer,
            })
            commandLog.addEntry(viewResult)
            return
        }

        await loadRemoteBookmarks()

        let needsPush = false
        if (!remoteBookmarksLoading() && !remoteBookmarksError()) {
            needsPush = hasOriginDiff(bookmark, remoteBookmarks())
        }

        if (needsPush) {
            const observer = commandLog.observer()
            const pushResult = await app.jjGitPush({
                cwd: getRepoPath(),
                bookmarks: [bookmark.name],
                observer,
            })
            commandLog.addEntry(pushResult)
            if (!pushResult.success) return
            await refresh()
        }

        const observer = commandLog.observer()
        const prResult = await app.ghPrCreateWeb(bookmark.name, {
            cwd: getRepoPath(),
            observer,
        })
        commandLog.addEntry(prResult)
        if (prResult.success) {
            refreshPullRequestMetadata()
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
        if (!githubStackingEnabled()) return undefined
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
        if (!githubStackingEnabled() || hasActiveFilter() || showRemoteOnly()) {
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
        if (!githubStackingEnabled()) return undefined
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

    const applyPreparedPlan = async (plan: StackPlan<Bookmark>) => {
        const observer = commandLog.observer()
        try {
            await app.applyStackPlan(plan, {
                cwd: getRepoPath(),
                observer,
            })
            await refresh()
            refreshPullRequestMetadata()
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
        stackRootName: string,
        observer?: ReturnType<typeof commandLog.observer>,
    ) =>
        app.prepareStackSync(stackRootName, {
            cwd: getRepoPath(),
            observer,
        })

    const stackDialogMinHeight = (rowCount: number) =>
        Math.max(18, rowCount + 14)

    const openStackPlan = async (stackRootName: string) => {
        const preparingRows = stackRows(stackRootName)
        const minHeight = stackDialogMinHeight(preparingRows.length)
        dialog.open(
            () => (
                <StackPreparingModal
                    kind="sync"
                    stackRootName={stackRootName}
                />
            ),
            {
                id: "bookmark-stack-sync-preparing",
                ...DIALOG_SIZE.confirmWide,
                minHeight,
                closeOnEsc: false,
                hints: [],
            },
        )
        try {
            const plan = await preparePlan(stackRootName)
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
                    id: "bookmark-stack-sync-plan",
                    title: [
                        { text: "Sync", style: "action" },
                        " preview for ",
                        { text: stackRootName, style: "target" },
                    ],
                    ...DIALOG_SIZE.confirmWide,
                    minHeight: stackDialogMinHeight(plan.rows.length),
                    closeOnEsc: false,
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

    const prepareAndApplyStack = async (stackRootName: string) => {
        const observer = commandLog.observer()
        try {
            const plan = await preparePlan(stackRootName, observer)
            if (plan.effects.length === 0) {
                status.show("Nothing to do; stack is already in sync.")
                return
            }
            await applyPreparedPlan(plan)
        } catch (error) {
            commandLog.addEntry({
                command: "stack sync",
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
            label: "sync",
            onSelect: () => openStackPlan(stackRootName),
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
        const rows = stackRows(stackRootName)
        dialog.open(
            () => (
                <StackActionsModal
                    stackRootName={stackRootName}
                    rows={rows}
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
                minHeight: stackDialogMinHeight(rows.length),
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

    const openSelectedStack = async () => {
        if (!githubStackingEnabled()) {
            status.show(
                "GitHub stacking is disabled. Run with KAJJI_ENABLE_STACKING=1 to enable it.",
            )
            return
        }
        if (showRemoteOnly()) return
        const row = selectedBookmarkRow()
        if (!row) return
        if (row.stackKeys.length === 0) {
            const persistedParent = await app.stackParent(row.bookmark.name, {
                cwd: getRepoPath(),
            })
            if (persistedParent) {
                openStackPlan(persistedParent)
                return
            }
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
        setListSelectionSource("keyboard")
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
        setListSelectionSource("keyboard")
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
    let listScrollResizeCleanup: (() => void) | undefined

    const [listScrollTop, setListScrollTop] = createSignal(0)
    const [listViewportHeight, setListViewportHeight] = createSignal(30)
    const [listViewportWidth, setListViewportWidth] = createSignal(40)
    const [listSelectionSource, setListSelectionSource] =
        createSignal<SelectionSource>("programmatic")
    const listThreshold = createMemo(() => {
        const buffer = Math.max(20, listViewportHeight() * 4)
        return Math.max(0, listTotalRows() - buffer)
    })
    const bookmarkContentText = (row: BookmarkRow) => {
        const bookmark = row.bookmark
        if (!bookmark.changeId) return "–deleted "
        const parts = []
        const prNumber = bookmarkPrNumbers().get(bookmark.name)
        if (prNumber) parts.push(`#${prNumber}`)
        parts.push(bookmark.changeIdDisplay || bookmark.changeId)
        if (showRemoteOnly() && bookmark.remote)
            parts.push(`@${bookmark.remote}`)
        parts.push(bookmark.descriptionDisplay || bookmark.description)
        return parts.join(" ")
    }
    const bookmarkOriginChangedWidth = (row: BookmarkRow) =>
        row.bookmark.isLocal &&
        originChangedBookmarkNames().has(row.bookmark.name)
            ? 1
            : 0
    const bookmarkNameWidth = (row: BookmarkRow) =>
        Math.min(
            getVisibleWidth(row.bookmark.nameDisplay || row.bookmark.name),
            Math.max(
                1,
                Math.max(8, Math.floor(listViewportWidth() * 0.6)) -
                    bookmarkOriginChangedWidth(row),
            ),
        )
    const bookmarkGutterWidth = (row: BookmarkRow) =>
        (row.depth > 0 ? Math.max(0, row.depth - 1) * 2 + 2 : 0) +
        bookmarkNameWidth(row) +
        bookmarkOriginChangedWidth(row) +
        1
    const bookmarkMaxContentWidth = createMemo(() => {
        let maxWidth = 0
        for (const row of displayBookmarkRows()) {
            const width = getVisibleWidth(bookmarkContentText(row))
            if (width > maxWidth) maxWidth = width
        }
        return maxWidth
    })
    const bookmarkMaxGutterWidth = createMemo(() => {
        let maxWidth = 0
        for (const row of displayBookmarkRows()) {
            const width = bookmarkGutterWidth(row)
            if (width > maxWidth) maxWidth = width
        }
        return maxWidth
    })
    const bookmarkHorizontal = createHorizontalCropScroll({
        scrollRef: () => listScrollRef,
        maxContentWidth: bookmarkMaxContentWidth,
        viewportContentWidth: () =>
            Math.max(
                1,
                bookmarkHorizontal.viewportWidth() - bookmarkMaxGutterWidth(),
            ),
    })

    const syncListViewport = () => {
        if (!listScrollRef) return
        const currentViewport = listScrollRef.viewport?.height ?? 30
        if (currentViewport !== listViewportHeight()) {
            setListViewportHeight(currentViewport)
        }
        const currentViewportWidth = listScrollRef.viewport?.width ?? 40
        if (currentViewportWidth !== listViewportWidth()) {
            setListViewportWidth(currentViewportWidth)
        }
        bookmarkHorizontal.syncViewportWidth()
    }

    const setListScrollRef = (ref: ScrollBoxRenderable) => {
        listScrollResizeCleanup?.()
        listScrollRef = ref
        const resizeable = ref as ScrollBoxRenderable & {
            on?: (event: "resize", callback: () => void) => void
            off?: (event: "resize", callback: () => void) => void
        }
        const handleResize = () => syncListViewport()
        resizeable.on?.("resize", handleResize)
        listScrollResizeCleanup = () => resizeable.off?.("resize", handleResize)
        syncListViewport()
        queueMicrotask(syncListViewport)
    }

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
                    selectionSource: listSelectionSource(),
                })
            },
        ),
    )

    onCleanup(() => {
        setListScrollTop(0)
        setListViewportHeight(30)
        listScrollResizeCleanup?.()
        listScrollResizeCleanup = undefined
    })

    onMount(() => {
        const pollInterval = setInterval(() => {
            if (!listScrollRef) return
            const currentScroll = listScrollRef.scrollTop ?? 0
            if (currentScroll !== listScrollTop()) {
                setListScrollTop(currentScroll)
            }
            syncListViewport()

            if (!bookmarksLoadingMore() && canPageBookmarks()) {
                if (currentScroll + listViewportHeight() >= listThreshold()) {
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
            group: "navigation",
            panel: "refs",
            visibleIn: ["palette"] as const,
            execute: selectNextBookmarkInView,
        },
        {
            id: "refs.bookmarks.prev",
            title: "up",
            keybind: "nav_up",
            context: "refs.bookmarks",
            group: "navigation",
            panel: "refs",
            visibleIn: ["palette"] as const,
            execute: selectPrevBookmarkInView,
        },
        {
            id: "refs.bookmarks.view_revisions",
            title: "view revisions",
            keybind: "enter",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette"] as const,
            execute: handleListEnter,
        },
        {
            id: "refs.bookmarks.new",
            title: "new",
            keybind: "jj_new",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
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
                runOperation("Creating...", (observer) =>
                    app.jjNew(bookmark.name, {
                        cwd: getRepoPath(),
                        observer,
                    }),
                )
            },
        },
        {
            id: "refs.bookmarks.edit",
            title: "edit",
            keybind: "jj_edit",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette", "statusBar"] as const,
            execute: async () => {
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
                const result = await app.jjEdit(bookmark.name, {
                    cwd: getRepoPath(),
                })
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
                        await runOperation("Editing...", (observer) =>
                            app.jjEdit(bookmark.name, {
                                cwd: getRepoPath(),
                                ignoreImmutable: true,
                                observer,
                            }),
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

            panel: "refs",
            visibleIn: ["palette"] as const,
            execute: activateBookmarkFilter,
        },
        {
            id: "refs.bookmarks.toggle_remote",
            title: "remote-only",
            keybind: "bookmark_toggle_remote",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette"] as const,
            execute: () => {
                setShowRemoteOnly((prev) => !prev)
                setRemoteSelectedIndex(0)
            },
        },
        {
            id: "refs.bookmarks.create",
            title: "create",
            keybind: "bookmark_create",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
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
                                runOperation(
                                    "Creating bookmark...",
                                    (observer) =>
                                        app.jjBookmarkCreate(name, {
                                            cwd: getRepoPath(),
                                            revision,
                                            observer,
                                        }),
                                )
                            }}
                        />
                    ),
                    {
                        id: "bookmark-create",
                        title: "Create Bookmark",
                        ...DIALOG_SIZE.form,
                    },
                )
            },
        },
        {
            id: "refs.bookmarks.delete",
            title: "delete",
            keybind: "bookmark_delete",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette", "statusBar"] as const,
            execute: async () => {
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
                    await runOperation("Deleting bookmark...", (observer) =>
                        app.jjBookmarkDelete(bookmark.name, {
                            cwd: getRepoPath(),
                            observer,
                        }),
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

            panel: "refs",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                dialog.open(
                    () => (
                        <BookmarkNameModal
                            initialValue={bookmark.name}
                            onSave={(newName) => {
                                runOperation(
                                    "Renaming bookmark...",
                                    (observer) =>
                                        app.jjBookmarkRename(
                                            bookmark.name,
                                            newName,
                                            {
                                                cwd: getRepoPath(),
                                                observer,
                                            },
                                        ),
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
                    },
                )
            },
        },
        {
            id: "refs.bookmarks.open",
            title: commits().find(
                (commit) => commit.commitId === selectedBookmark()?.commitId,
            )?.inTrunk
                ? "open commit"
                : "open PR",
            keybind: "open",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette", "statusBar"] as const,
            execute: () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                openForBookmark(bookmark)
            },
        },
        {
            id: "refs.bookmarks.forget",
            title: "forget",
            keybind: "bookmark_forget",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette"] as const,
            execute: async () => {
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
                    await runOperation("Forgetting bookmark...", (observer) =>
                        app.jjBookmarkForget(bookmark.name, {
                            cwd: getRepoPath(),
                            observer,
                        }),
                    )
                }
            },
        },
        {
            id: "refs.bookmarks.move",
            title: "move",
            keybind: "bookmark_move",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: ["palette"] as const,
            execute: () => {
                if (showRemoteOnly()) return
                const bookmark = selectedBookmark()
                if (!bookmark) return
                dialog.open(
                    () => (
                        <RevisionPickerModal
                            commits={commits()}
                            defaultRevision={bookmark.changeId}
                            onSelect={(revision) => {
                                runOperation("Moving bookmark...", (observer) =>
                                    app.jjBookmarkSet(bookmark.name, revision, {
                                        cwd: getRepoPath(),
                                        observer,
                                    }),
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
                    },
                )
            },
        },
        ...(githubStackingEnabled()
            ? [
                  {
                      id: "refs.bookmarks.stack",
                      title: "stack",
                      keybind: "bookmark_stack" as const,
                      context: "refs.bookmarks" as const,
                      panel: "refs" as const,
                      visibleIn: ["palette", "statusBar"] as const,
                      execute: openSelectedStack,
                  },
              ]
            : []),
        {
            id: "refs.bookmarks.diff_origin",
            title: "compare to origin",
            keybind: "bookmark_diff_origin",
            context: "refs.bookmarks",

            panel: "refs",
            visibleIn: selectedBookmarkHasOriginDiff()
                ? (["palette", "statusBar"] as const)
                : (["palette"] as const),
            execute: openSelectedBookmarkOriginDiff,
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
                            ref={setListScrollRef}
                            flexGrow={1}
                            backgroundColor={colors().background}
                            scrollbarOptions={{ visible: false }}
                            onMouseScroll={bookmarkHorizontal.onMouseScroll}
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
                                        setListSelectionSource("mouse")
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
                                    const bookmarkContentWidth = () =>
                                        Math.max(
                                            1,
                                            bookmarkHorizontal.viewportWidth() -
                                                bookmarkGutterWidth(row),
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
                                                    horizontalScroll={{
                                                        cropStart:
                                                            bookmarkHorizontal.cropStart(),
                                                        cropWidth:
                                                            bookmarkContentWidth(),
                                                    }}
                                                    maxNameWidth={bookmarkNameWidth(
                                                        row,
                                                    )}
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
