import { createMemo } from "solid-js"
import { truncatePathMiddle } from "../utils/path-truncate"
import { type BinaryCardLine, BinaryRainCard } from "./BinaryRainCard"

const DEFAULT_RAIN_PADDING = 3
const MAX_VISIBLE_PATHS = 8
const CARD_PADDING_X = 2
const CARD_PADDING_Y = 1
const PATH_MAX_WIDTH = 72
const PATH_MIN_WIDTH = 12

export interface BinaryGroupFooterProps {
    width: number
    paths: string[]
    /** Extra rain rows above and below the card. */
    rainPadding?: number
}

export function BinaryGroupFooter(props: BinaryGroupFooterProps) {
    const rainPadding = () => props.rainPadding ?? DEFAULT_RAIN_PADDING

    const lines = createMemo<BinaryCardLine[]>(() => {
        const paths = props.paths
        if (paths.length === 0) return []

        const width = Math.max(1, props.width)
        const pathMax = Math.max(
            PATH_MIN_WIDTH,
            Math.min(PATH_MAX_WIDTH, width - CARD_PADDING_X * 2 - 4),
        )

        const heading: BinaryCardLine =
            paths.length === 1
                ? { text: "BINARY FILE", style: "heading" }
                : { text: `${paths.length} BINARY FILES`, style: "heading" }

        const visible = paths.slice(0, MAX_VISIBLE_PATHS)
        const pathLines: BinaryCardLine[] = visible.map((p) => ({
            text: truncatePathMiddle(p, pathMax),
            style: "muted",
        }))

        const overflow = paths.length - visible.length
        const overflowLine: BinaryCardLine[] =
            overflow > 0
                ? [{ text: `… and ${overflow} more`, style: "muted" }]
                : []

        return [heading, ...pathLines, ...overflowLine]
    })

    const height = createMemo(() => {
        const cardH = lines().length + CARD_PADDING_Y * 2
        return cardH + rainPadding() * 2
    })

    return (
        <box flexShrink={0}>
            <BinaryRainCard
                width={Math.max(1, props.width)}
                height={Math.max(1, height())}
                lines={lines()}
                paddingX={CARD_PADDING_X}
                paddingY={CARD_PADDING_Y}
            />
        </box>
    )
}
