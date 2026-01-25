import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { ptyToJson } from "ghostty-opentui"
import { parseOpLog } from "../../src/commander/operations"

const RESULTS_FILE = join(import.meta.dir, "../../bench-results.json")

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[91;1m",
	green: "\x1b[92;1m",
	yellow: "\x1b[93m",
	blue: "\x1b[38;5;12m",
	cyan: "\x1b[38;5;6m",
	magenta: "\x1b[38;5;5m",
}

function generateDiffLine(
	lineNum: number,
	type: "add" | "del" | "ctx",
): string {
	const num = String(lineNum).padStart(4)
	const content = `const variable${lineNum} = "value ${lineNum}"`
	if (type === "add") {
		return `${ANSI.green}${num} ${ANSI.reset}${ANSI.green}${content}${ANSI.reset}`
	}
	if (type === "del") {
		return `${ANSI.red}${num} ${ANSI.reset}${ANSI.red}${content}${ANSI.reset}`
	}
	return `${ANSI.dim}${num} ${ANSI.reset}${content}`
}

function generateDiff(lineCount: number): string {
	const lines: string[] = []
	lines.push(
		`${ANSI.bold}${ANSI.yellow}src/example.ts${ANSI.reset}${ANSI.dim} --- TypeScript${ANSI.reset}`,
	)

	for (let i = 0; i < lineCount; i++) {
		const mod = i % 10
		if (mod < 3) {
			lines.push(generateDiffLine(i, "ctx"))
		} else if (mod < 6) {
			lines.push(generateDiffLine(i, "del"))
		} else {
			lines.push(generateDiffLine(i, "add"))
		}
	}
	return lines.join("\n")
}

function generateOplogEntry(index: number): string[] {
	const opId = Math.random().toString(16).slice(2, 14)
	const timestamp = index === 0 ? "now" : `${index} minutes ago`
	return [
		`${ANSI.bold}@${ANSI.reset}  ${ANSI.bold}${ANSI.blue}${opId}${ANSI.reset} ${ANSI.yellow}user@host${ANSI.reset} ${ANSI.cyan}${timestamp}${ANSI.reset}`,
		`│  ${ANSI.bold}snapshot working copy${ANSI.reset}`,
		`│  ${ANSI.magenta}args: jj log${ANSI.reset}`,
	]
}

function generateOplog(entryCount: number): string[] {
	const lines: string[] = []
	for (let i = 0; i < entryCount; i++) {
		lines.push(...generateOplogEntry(i))
	}
	return lines
}

interface BenchResult {
	name: string
	iterations: number
	totalMs: number
	meanMs: number
	minMs: number
	maxMs: number
	p95Ms: number
	opsPerSec: number
}

interface BenchResults {
	timestamp: string
	results: BenchResult[]
}

function benchmark(
	name: string,
	fn: () => void,
	iterations = 100,
): BenchResult {
	const times: number[] = []

	for (let i = 0; i < 5; i++) fn()

	for (let i = 0; i < iterations; i++) {
		const start = performance.now()
		fn()
		times.push(performance.now() - start)
	}

	times.sort((a, b) => a - b)
	const totalMs = times.reduce((a, b) => a + b, 0)
	const meanMs = totalMs / iterations
	const p95Index = Math.floor(iterations * 0.95)

	return {
		name,
		iterations,
		totalMs,
		meanMs,
		minMs: times[0] ?? 0,
		maxMs: times[iterations - 1] ?? 0,
		p95Ms: times[p95Index] ?? 0,
		opsPerSec: 1000 / meanMs,
	}
}

function formatResult(r: BenchResult): string {
	return `${r.name}: mean=${r.meanMs.toFixed(2)}ms, p95=${r.p95Ms.toFixed(2)}ms, ops/s=${r.opsPerSec.toFixed(0)}`
}

const allResults: BenchResult[] = []

describe("ANSI parsing (ptyToJson)", () => {
	const diffSmall = generateDiff(100)
	const diffMedium = generateDiff(600)
	const diffLarge = generateDiff(25000)
	const diffXlarge = generateDiff(50000)

	test("small diff (~100 lines)", () => {
		const result = benchmark("ansi-parse-diff-small", () => {
			ptyToJson(diffSmall, { cols: 200, rows: 1 })
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(50)
	})

	test("medium diff (~600 lines)", () => {
		const result = benchmark("ansi-parse-diff-medium", () => {
			ptyToJson(diffMedium, { cols: 200, rows: 1 })
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(100)
	})

	test("large diff (~25k lines)", () => {
		const result = benchmark(
			"ansi-parse-diff-large",
			() => {
				ptyToJson(diffLarge, { cols: 200, rows: 1 })
			},
			20,
		)
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(2000)
	})

	test("xlarge diff (~50k lines)", () => {
		const result = benchmark(
			"ansi-parse-diff-xlarge",
			() => {
				ptyToJson(diffXlarge, { cols: 200, rows: 1 })
			},
			10,
		)
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(5000)
	})
})

describe("Oplog parsing (parseOpLog)", () => {
	const oplogSmall = generateOplog(500)
	const oplogMedium = generateOplog(5000)
	const oplogLarge = generateOplog(20000)

	test("small oplog (500 entries)", () => {
		const result = benchmark("oplog-parse-small", () => {
			parseOpLog(oplogSmall)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(20)
	})

	test("medium oplog (5000 entries)", () => {
		const result = benchmark("oplog-parse-medium", () => {
			parseOpLog(oplogMedium)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(100)
	})

	test("large oplog (20000 entries)", () => {
		const result = benchmark(
			"oplog-parse-large",
			() => {
				parseOpLog(oplogLarge)
			},
			20,
		)
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(500)
	})
})

describe("Results", () => {
	test("write results to file", () => {
		const results: BenchResults = {
			timestamp: new Date().toISOString(),
			results: allResults,
		}
		writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2))
		console.log("\nResults written to bench-results.json")
	})
})
