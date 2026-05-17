import { createMemo } from "solid-js"
import { type BinaryCardLine, BinaryRainCard } from "./BinaryRainCard"

const CARD_MAX_FILENAME_WIDTH = 48

export interface BinaryPlaceholderProps {
    width: number
    height: number
    path?: string
}

function truncateMiddle(value: string, max: number): string {
    if (value.length <= max) return value
    if (max <= 1) return value.slice(0, max)
    const keep = max - 1
    const left = Math.ceil(keep / 2)
    const right = Math.floor(keep / 2)
    return `${value.slice(0, left)}…${value.slice(value.length - right)}`
}

export function BinaryPlaceholder(props: BinaryPlaceholderProps) {
    const lines = createMemo<BinaryCardLine[]>(() => {
        const path = props.path
        const base = path ? path.split("/").pop() : undefined
        const filename = base && base.length > 0 ? base : "binary file"
        return [
            { text: "BINARY", style: "heading" },
            {
                text: truncateMiddle(filename, CARD_MAX_FILENAME_WIDTH),
                style: "primary",
            },
            { text: "no diff preview", style: "muted" },
        ]
    })

    return (
        <BinaryRainCard
            width={props.width}
            height={props.height}
            lines={lines()}
        />
    )
}
