import type { MouseEvent } from "@opentui/core"
import type { TerminalLine } from "ghostty-opentui"
import { ptyToJson } from "ghostty-opentui"
import { For, Show, createEffect, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { resolveAnsiForeground } from "../theme/ansi"
import { profile } from "../utils/profiler"

type AnsiSpan = {
	text: string
	fg?: string | null
	bg?: string | null
	flags?: number
	width?: number
}

type AnsiLine = {
	spans: AnsiSpan[]
}

interface AnsiTextProps {
	content: string
	cols?: number
	bold?: boolean
	wrapMode?: "none" | "char" | "word"
	maxLines?: number
	defaultFg?: string
	onTotalLines?: (total: number) => void
	onMouseScroll?: (event: MouseEvent) => void
	cropStart?: number
	cropWidth?: number
}

export function AnsiText(props: AnsiTextProps) {
	const { colors, mode } = useTheme()

	const resolveFg = (fg: string | null | undefined): string =>
		resolveAnsiForeground({
			fg,
			mode: mode(),
			text: colors().text,
			textMuted: colors().textMuted,
			defaultFg: props.defaultFg,
		})

	const allLines = createMemo(() => {
		if (!props.content) return [] as AnsiLine[]
		const endParse = profile("ptyToJson parse")
		const result = ptyToJson(props.content, {
			cols: props.cols ?? 9999,
			rows: 1,
		})
		endParse(`${result.lines.length} lines from ${props.content.length} chars`)
		return result.lines
	})

	createEffect(() => {
		const total = allLines().length
		props.onTotalLines?.(total)
	})

	const visibleLines = createMemo(() => {
		const lines = allLines()
		const limit = props.maxLines
		if (limit !== undefined && lines.length > limit) {
			return lines.slice(0, limit)
		}
		return lines
	})

	const sliceSpans = (spans: AnsiSpan[], start: number, width: number) => {
		const end = start + width
		let offset = 0
		const result: AnsiSpan[] = []

		for (const span of spans) {
			const spanLength = span.text.length
			const spanStart = offset
			const spanEnd = offset + spanLength
			offset = spanEnd

			if (spanEnd <= start) continue
			if (spanStart >= end) break

			const sliceStart = Math.max(0, start - spanStart)
			const sliceEnd = Math.min(spanLength, end - spanStart)
			if (sliceEnd > sliceStart) {
				result.push({
					...span,
					text: span.text.slice(sliceStart, sliceEnd),
				})
			}
		}

		return result
	}

	const renderSpans = (line: AnsiLine) => {
		const start = props.cropStart ?? 0
		const width = props.cropWidth
		const spans =
			width === undefined ? line.spans : sliceSpans(line.spans, start, width)

		return (
			<For each={spans}>
				{(span) => (
					<span
						style={{
							fg: resolveFg(span.fg),
							bg: span.bg ?? undefined,
						}}
					>
						{span.text}
					</span>
				)}
			</For>
		)
	}

	return (
		<For each={visibleLines()}>
			{(line) => (
				<text
					wrapMode={props.wrapMode ?? "word"}
					onMouseScroll={props.onMouseScroll}
				>
					<Show when={props.bold} fallback={renderSpans(line)}>
						<b>{renderSpans(line)}</b>
					</Show>
				</text>
			)}
		</For>
	)
}
