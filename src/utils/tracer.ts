/**
 * Structured profiling system with hierarchical span tracking
 * Inspired by React DevTools Profiler flamegraph visualization
 *
 * Usage:
 *   const trace = tracer.startTrace("diff-render")
 *   const span = trace.startSpan("parse")
 *   // ... work ...
 *   span.end()
 *   trace.end() // logs full trace with nested spans
 */

export interface SpanData {
	name: string
	startTime: number
	endTime: number
	duration: number
	metadata?: Record<string, unknown>
	children: SpanData[]
	parent: SpanData | null
}

export interface TraceData {
	id: string
	name: string
	startTime: number
	endTime: number
	duration: number
	spans: SpanData[]
	metadata?: Record<string, unknown>
}

export interface Span {
	name: string
	addMetadata(data: Record<string, unknown>): void
	startSpan(name: string, metadata?: Record<string, unknown>): Span
	end(): SpanData
}

export interface Trace {
	id: string
	name: string
	startSpan(name: string, metadata?: Record<string, unknown>): Span
	addMetadata(data: Record<string, unknown>): void
	end(): TraceData
}

export interface TracerConfig {
	enabled: boolean
	outputMode: "console" | "file" | "callback" | "silent"
	filePath?: string
	callback?: (trace: TraceData) => void
	minDurationMs?: number // Only log traces longer than this
	sampleRate?: number // 0-1, percentage of traces to capture
}

const DEFAULT_CONFIG: TracerConfig = {
	enabled: process.env.KAJJI_TRACE === "1",
	outputMode: "console",
	minDurationMs: 0,
	sampleRate: 1,
}

let config: TracerConfig = { ...DEFAULT_CONFIG }
let traceIdCounter = 0
const activeTraces = new Map<string, TraceData>()
const traceHistory: TraceData[] = []
const MAX_HISTORY = 100

// File output buffer for batched writes
let fileBuffer: string[] = []
let fileFlushTimeout: ReturnType<typeof setTimeout> | null = null

function shouldSample(): boolean {
	if (config.sampleRate === 1) return true
	return Math.random() < (config.sampleRate ?? 1)
}

function formatDuration(ms: number): string {
	if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
	if (ms < 1000) return `${ms.toFixed(2)}ms`
	return `${(ms / 1000).toFixed(2)}s`
}

function formatSpanTree(span: SpanData, indent = 0): string {
	const prefix = "  ".repeat(indent)
	const bar = "│ ".repeat(Math.max(0, indent - 1)) + (indent > 0 ? "├─" : "")
	const duration = formatDuration(span.duration)
	const meta = span.metadata ? ` ${JSON.stringify(span.metadata)}` : ""

	let result = `${bar}${span.name} (${duration})${meta}\n`

	for (const child of span.children) {
		result += formatSpanTree(child, indent + 1)
	}

	return result
}

function formatTraceOutput(trace: TraceData): string {
	const header = `\n╭─ TRACE: ${trace.name} [${trace.id}] ─ ${formatDuration(trace.duration)}`
	const meta = trace.metadata
		? `\n│ metadata: ${JSON.stringify(trace.metadata)}`
		: ""

	let spans = ""
	for (const span of trace.spans) {
		spans += formatSpanTree(span, 1)
	}

	const footer = `╰${"─".repeat(50)}\n`

	return `${header}${meta}\n${spans}${footer}`
}

function outputTrace(trace: TraceData): void {
	if (!config.enabled) return
	if (trace.duration < (config.minDurationMs ?? 0)) return

	switch (config.outputMode) {
		case "console":
			console.error(formatTraceOutput(trace))
			break
		case "file":
			bufferFileWrite(trace)
			break
		case "callback":
			config.callback?.(trace)
			break
		case "silent":
			// Just store in history
			break
	}

	traceHistory.push(trace)
	if (traceHistory.length > MAX_HISTORY) {
		traceHistory.shift()
	}
}

function bufferFileWrite(trace: TraceData): void {
	const line = JSON.stringify({
		...trace,
		timestamp: new Date().toISOString(),
	})
	fileBuffer.push(line)

	if (!fileFlushTimeout) {
		fileFlushTimeout = setTimeout(flushFileBuffer, 100)
	}
}

async function flushFileBuffer(): Promise<void> {
	if (fileBuffer.length === 0) return

	const lines = fileBuffer.join("\n") + "\n"
	fileBuffer = []
	fileFlushTimeout = null

	if (config.filePath) {
		try {
			const { appendFileSync, mkdirSync } = await import("node:fs")
			const { dirname } = await import("node:path")
			mkdirSync(dirname(config.filePath), { recursive: true })
			appendFileSync(config.filePath, lines)
		} catch {
			// Silent fail
		}
	}
}

function createSpan(
	name: string,
	parent: SpanData | null,
	metadata?: Record<string, unknown>,
): Span {
	const spanData: SpanData = {
		name,
		startTime: performance.now(),
		endTime: 0,
		duration: 0,
		metadata,
		children: [],
		parent,
	}

	if (parent) {
		parent.children.push(spanData)
	}

	return {
		name,
		addMetadata(data: Record<string, unknown>) {
			spanData.metadata = { ...spanData.metadata, ...data }
		},
		startSpan(childName: string, childMeta?: Record<string, unknown>): Span {
			return createSpan(childName, spanData, childMeta)
		},
		end(): SpanData {
			spanData.endTime = performance.now()
			spanData.duration = spanData.endTime - spanData.startTime
			return spanData
		},
	}
}

function createTrace(name: string): Trace {
	const id = `trace_${++traceIdCounter}`
	const traceData: TraceData = {
		id,
		name,
		startTime: performance.now(),
		endTime: 0,
		duration: 0,
		spans: [],
	}

	activeTraces.set(id, traceData)

	return {
		id,
		name,
		startSpan(spanName: string, metadata?: Record<string, unknown>): Span {
			const span = createSpan(spanName, null, metadata)
			// We need to track root spans
			const originalEnd = span.end
			const wrappedSpan: Span = {
				...span,
				end() {
					const data = originalEnd()
					traceData.spans.push(data)
					return data
				},
			}
			return wrappedSpan
		},
		addMetadata(data: Record<string, unknown>) {
			traceData.metadata = { ...traceData.metadata, ...data }
		},
		end(): TraceData {
			traceData.endTime = performance.now()
			traceData.duration = traceData.endTime - traceData.startTime
			activeTraces.delete(id)
			outputTrace(traceData)
			return traceData
		},
	}
}

// Null/noop implementations for when tracing is disabled
const noopSpan: Span = {
	name: "noop",
	addMetadata: () => {},
	startSpan: () => noopSpan,
	end: () => ({
		name: "noop",
		startTime: 0,
		endTime: 0,
		duration: 0,
		children: [],
		parent: null,
	}),
}

const noopTrace: Trace = {
	id: "noop",
	name: "noop",
	startSpan: () => noopSpan,
	addMetadata: () => {},
	end: () => ({
		id: "noop",
		name: "noop",
		startTime: 0,
		endTime: 0,
		duration: 0,
		spans: [],
	}),
}

export const tracer = {
	configure(newConfig: Partial<TracerConfig>): void {
		config = { ...config, ...newConfig }
	},

	isEnabled(): boolean {
		return config.enabled
	},

	startTrace(name: string): Trace {
		if (!config.enabled || !shouldSample()) {
			return noopTrace
		}
		return createTrace(name)
	},

	/**
	 * Convenience wrapper for timing a single operation
	 */
	time<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
		if (!config.enabled) return fn()

		const trace = createTrace(name)
		if (metadata) trace.addMetadata(metadata)

		try {
			const result = fn()
			trace.end()
			return result
		} catch (err) {
			trace.addMetadata({ error: String(err) })
			trace.end()
			throw err
		}
	},

	/**
	 * Async version of time()
	 */
	async timeAsync<T>(
		name: string,
		fn: () => Promise<T>,
		metadata?: Record<string, unknown>,
	): Promise<T> {
		if (!config.enabled) return fn()

		const trace = createTrace(name)
		if (metadata) trace.addMetadata(metadata)

		try {
			const result = await fn()
			trace.end()
			return result
		} catch (err) {
			trace.addMetadata({ error: String(err) })
			trace.end()
			throw err
		}
	},

	getHistory(): TraceData[] {
		return [...traceHistory]
	},

	getActiveTraces(): TraceData[] {
		return [...activeTraces.values()]
	},

	clearHistory(): void {
		traceHistory.length = 0
	},

	/**
	 * Get a summary of recent traces grouped by name
	 */
	getSummary(): Record<
		string,
		{ count: number; avgMs: number; maxMs: number; minMs: number }
	> {
		const summary: Record<
			string,
			{ count: number; totalMs: number; maxMs: number; minMs: number }
		> = {}

		for (const trace of traceHistory) {
			if (!summary[trace.name]) {
				summary[trace.name] = {
					count: 0,
					totalMs: 0,
					maxMs: 0,
					minMs: Number.POSITIVE_INFINITY,
				}
			}
			const s = summary[trace.name]!
			s.count++
			s.totalMs += trace.duration
			s.maxMs = Math.max(s.maxMs, trace.duration)
			s.minMs = Math.min(s.minMs, trace.duration)
		}

		const result: Record<
			string,
			{ count: number; avgMs: number; maxMs: number; minMs: number }
		> = {}
		for (const [name, data] of Object.entries(summary)) {
			result[name] = {
				count: data.count,
				avgMs: data.totalMs / data.count,
				maxMs: data.maxMs,
				minMs: data.minMs === Number.POSITIVE_INFINITY ? 0 : data.minMs,
			}
		}

		return result
	},

	/**
	 * Format summary as a table string
	 */
	formatSummary(): string {
		const summary = this.getSummary()
		const entries = Object.entries(summary).sort(
			(a, b) => b[1].avgMs - a[1].avgMs,
		)

		if (entries.length === 0) return "No traces recorded"

		const header =
			"Trace Name                    │ Count │   Avg   │   Max   │   Min"
		const separator =
			"─".repeat(30) +
			"┼" +
			"─".repeat(7) +
			"┼" +
			"─".repeat(9) +
			"┼" +
			"─".repeat(9) +
			"┼" +
			"─".repeat(9)

		const rows = entries.map(([name, data]) => {
			const padName = name.slice(0, 28).padEnd(30)
			const count = String(data.count).padStart(5)
			const avg = formatDuration(data.avgMs).padStart(7)
			const max = formatDuration(data.maxMs).padStart(7)
			const min = formatDuration(data.minMs).padStart(7)
			return `${padName}│${count} │${avg} │${max} │${min}`
		})

		return [header, separator, ...rows].join("\n")
	},
}
