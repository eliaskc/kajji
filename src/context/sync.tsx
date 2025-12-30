import {
	type JSX,
	createContext,
	createEffect,
	createSignal,
	useContext,
} from "solid-js"
import { fetchDiff } from "../commander/diff"
import { fetchLog } from "../commander/log"
import type { Commit } from "../commander/types"

type FocusedPanel = "log" | "diff"

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
	focusedPanel: () => FocusedPanel
	toggleFocus: () => void
}

const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: { children: JSX.Element }) {
	const [commits, setCommits] = createSignal<Commit[]>([])
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [diff, setDiff] = createSignal<string | null>(null)
	const [diffLoading, setDiffLoading] = createSignal(false)
	const [diffError, setDiffError] = createSignal<string | null>(null)
	const [focusedPanel, setFocusedPanel] = createSignal<FocusedPanel>("log")

	const toggleFocus = () => {
		setFocusedPanel((p) => (p === "log" ? "diff" : "log"))
	}

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

	const loadDiff = async (changeId: string) => {
		setDiffLoading(true)
		setDiffError(null)
		try {
			const result = await fetchDiff(changeId)
			setDiff(result)
		} catch (e) {
			setDiffError(e instanceof Error ? e.message : "Failed to load diff")
			setDiff(null)
		} finally {
			setDiffLoading(false)
		}
	}

	createEffect(() => {
		const commit = selectedCommit()
		if (commit) {
			loadDiff(commit.changeId)
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
		focusedPanel,
		toggleFocus,
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
