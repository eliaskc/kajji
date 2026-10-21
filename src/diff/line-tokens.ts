import { MAX_EMPHASIS_SEGMENTS, MAX_HIGHLIGHT_LINE_LENGTH } from "./preparation-limits"
import { lineContentLength } from "./row-window"
import type { SyntaxToken } from "./syntax"
import type { WordDiffSegment } from "./word-diff"

export interface TokenWithEmphasis extends SyntaxToken {
    emphasis?: boolean
}

/** Keep segment preparation and later token slicing bounded, even for structural input. */
export function prepareLineTokens(
    source: string,
    wordDiff: WordDiffSegment[] | undefined,
    emphasisType: "removed" | "added",
    defaultColor: string,
    tokenize?: (content: string) => SyntaxToken[],
): TokenWithEmphasis[] {
    const content = source.slice(0, lineContentLength(source))
    if (
        content.length > MAX_HIGHLIGHT_LINE_LENGTH ||
        (wordDiff?.length ?? 0) > MAX_EMPHASIS_SEGMENTS
    ) {
        // One token permits direct string slicing at any offset. Never send the full
        // long line (or its emphasis fragments) to the syntax worker.
        return [{ content, color: defaultColor, emphasis: wordDiff ? true : undefined }]
    }
    // Structural emphasis is supplied externally. Bound its total text as well as
    // segment count before tokenizing.
    let chars = 0
    for (const segment of wordDiff ?? []) {
        chars += segment.text.length
        if (chars > MAX_HIGHLIGHT_LINE_LENGTH) {
            return [{ content, color: defaultColor, emphasis: true }]
        }
    }
    const tokens = (tokenize?.(content) ?? [{ content }]).map((token) => ({
        content: token.content,
        color: token.color ?? defaultColor,
    }))
    if (!wordDiff) return tokens

    // Split the line's syntax tokens at segment boundaries. Segments may also
    // cover the line terminator, which is not part of `content`.
    const result: TokenWithEmphasis[] = []
    let tokenIndex = 0
    let tokenOffset = 0
    for (const segment of wordDiff) {
        let remaining = segment.text.length
        while (remaining > 0 && tokenIndex < tokens.length) {
            const token = tokens[tokenIndex]!
            const take = Math.min(remaining, token.content.length - tokenOffset)
            if (take > 0)
                result.push({
                    content: token.content.slice(tokenOffset, tokenOffset + take),
                    color: token.color,
                    emphasis: segment.type === emphasisType,
                })
            remaining -= take
            tokenOffset += take
            if (tokenOffset === token.content.length) {
                tokenIndex++
                tokenOffset = 0
            }
        }
    }
    for (; tokenIndex < tokens.length; tokenIndex++, tokenOffset = 0) {
        const token = tokens[tokenIndex]!
        if (tokenOffset < token.content.length)
            result.push({ content: token.content.slice(tokenOffset), color: token.color })
    }
    return result
}

/** Inputs contain at most one long plain token or a bounded highlighted line. */
export function sliceTokens<T extends { content: string }>(
    tokens: T[],
    start: number,
    length: number,
): T[] {
    if (length <= 0) return []
    const end = start + length
    let offset = 0
    const result: T[] = []
    for (const token of tokens) {
        const tokenStart = offset
        offset += token.content.length
        if (offset <= start) continue
        if (tokenStart >= end) break
        const sliceStart = Math.max(0, start - tokenStart)
        const sliceEnd = Math.min(token.content.length, end - tokenStart)
        if (sliceEnd > sliceStart)
            result.push({ ...token, content: token.content.slice(sliceStart, sliceEnd) })
    }
    return result
}
