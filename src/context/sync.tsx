import { type JSX, createContext, createSignal, useContext } from "solid-js"
import { fetchLog } from "../commander/log"
import type { Commit } from "../commander/types"

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
}

const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: { children: JSX.Element }) {
	const [commits, setCommits] = createSignal<Commit[]>([])
	const [selectedIndex, setSelectedIndex] = createSignal(0)
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

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
