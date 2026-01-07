import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { computeWordDiff, flattenDiff, parseDiffString } from "../../src/diff"

const RESULTS_FILE = join(import.meta.dir, "../../bench-diff-results.json")

function generateGitDiff(
	fileCount: number,
	hunksPerFile: number,
	linesPerHunk: number,
): string {
	const lines: string[] = []

	for (let f = 0; f < fileCount; f++) {
		const fileName = `src/components/Example${f}.tsx`
		lines.push(`diff --git a/${fileName} b/${fileName}`)
		lines.push("index abc1234..def5678 100644")
		lines.push(`--- a/${fileName}`)
		lines.push(`+++ b/${fileName}`)

		for (let h = 0; h < hunksPerFile; h++) {
			const startLine = h * linesPerHunk + 1
			lines.push(
				`@@ -${startLine},${linesPerHunk} +${startLine},${linesPerHunk} @@ function example${h}()`,
			)

			for (let l = 0; l < linesPerHunk; l++) {
				const lineNum = startLine + l
				const mod = l % 10
				if (mod < 3) {
					lines.push(` const context${lineNum} = "unchanged"`)
				} else if (mod < 6) {
					lines.push(`-const old${lineNum} = "deleted value"`)
				} else {
					lines.push(`+const new${lineNum} = "added value"`)
				}
			}
		}
	}

	return lines.join("\n")
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

describe("Git diff parsing (@pierre/diffs)", () => {
	const diffSmall = generateGitDiff(3, 2, 20)
	const diffMedium = generateGitDiff(10, 5, 50)
	const diffLarge = generateGitDiff(50, 10, 100)
	const diffXlarge = generateGitDiff(100, 20, 100)

	test("small diff (3 files, 2 hunks, 20 lines each)", () => {
		const result = benchmark("diff-parse-small", () => {
			parseDiffString(diffSmall)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(10)
	})

	test("medium diff (10 files, 5 hunks, 50 lines each)", () => {
		const result = benchmark("diff-parse-medium", () => {
			parseDiffString(diffMedium)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(50)
	})

	test("large diff (50 files, 10 hunks, 100 lines each)", () => {
		const result = benchmark(
			"diff-parse-large",
			() => {
				parseDiffString(diffLarge)
			},
			50,
		)
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(200)
	})

	test("xlarge diff (100 files, 20 hunks, 100 lines each)", () => {
		const result = benchmark(
			"diff-parse-xlarge",
			() => {
				parseDiffString(diffXlarge)
			},
			20,
		)
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(500)
	})
})

describe("Diff flattening (parseDiff → flattenDiff)", () => {
	const diffMedium = generateGitDiff(10, 5, 50)
	const parsedMedium = parseDiffString(diffMedium)

	const diffLarge = generateGitDiff(50, 10, 100)
	const parsedLarge = parseDiffString(diffLarge)

	test("medium diff flatten", () => {
		const result = benchmark("diff-flatten-medium", () => {
			flattenDiff(parsedMedium)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(20)
	})

	test("large diff flatten", () => {
		const result = benchmark(
			"diff-flatten-large",
			() => {
				flattenDiff(parsedLarge)
			},
			50,
		)
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(100)
	})
})

describe("Word-level diff computation", () => {
	const shortLines = {
		old: 'const foo = "hello world"',
		new: 'const foo = "hello universe"',
	}

	const mediumLines = {
		old: "export function processData(input: string, options: ProcessOptions = {}): ProcessResult { return { success: true } }",
		new: "export function processData(input: string, config: ProcessConfig = defaultConfig): ProcessResult { return { success: true, data: input } }",
	}

	const longLines = {
		old: 'const complexExpression = someFunction(arg1, arg2, { nested: { deeply: { value: "original" } }, array: [1, 2, 3, 4, 5] }, callback)',
		new: 'const complexExpression = someFunction(arg1, arg3, { nested: { deeply: { value: "modified" } }, array: [1, 2, 3, 4, 5, 6] }, callback, extraArg)',
	}

	test("short line word diff", () => {
		const result = benchmark("word-diff-short", () => {
			computeWordDiff(shortLines.old, shortLines.new)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(1)
	})

	test("medium line word diff", () => {
		const result = benchmark("word-diff-medium", () => {
			computeWordDiff(mediumLines.old, mediumLines.new)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(2)
	})

	test("long line word diff", () => {
		const result = benchmark("word-diff-long", () => {
			computeWordDiff(longLines.old, longLines.new)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(5)
	})
})

describe("Full pipeline (parse → flatten)", () => {
	const diffSmall = generateGitDiff(3, 2, 20)
	const diffMedium = generateGitDiff(10, 5, 50)
	const diffLarge = generateGitDiff(50, 10, 100)

	test("small diff full pipeline (<100ms target)", () => {
		const result = benchmark("pipeline-small", () => {
			const parsed = parseDiffString(diffSmall)
			flattenDiff(parsed)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(100)
	})

	test("medium diff full pipeline (<100ms target)", () => {
		const result = benchmark("pipeline-medium", () => {
			const parsed = parseDiffString(diffMedium)
			flattenDiff(parsed)
		})
		allResults.push(result)
		console.log(formatResult(result))
		expect(result.p95Ms).toBeLessThan(100)
	})

	test("large diff full pipeline (<500ms target)", () => {
		const result = benchmark(
			"pipeline-large",
			() => {
				const parsed = parseDiffString(diffLarge)
				flattenDiff(parsed)
			},
			50,
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
		console.log("\nResults written to bench-diff-results.json")
	})
})
