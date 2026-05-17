import { For, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { BinaryRain } from "./BinaryRain"

export type BinaryCardLineStyle = "heading" | "primary" | "muted"

export interface BinaryCardLine {
    text: string
    style: BinaryCardLineStyle
}

export interface BinaryRainCardProps {
    width: number
    height: number
    lines: BinaryCardLine[]
    /** Horizontal card padding inside the mask (default 2). */
    paddingX?: number
    /** Vertical card padding inside the mask (default 1). */
    paddingY?: number
    /** Rain fade border around the mask in cells (default 1). */
    fade?: number
    /** Tick interval for the rain in ms. */
    interval?: number
}

export function BinaryRainCard(props: BinaryRainCardProps) {
    const { colors } = useTheme()

    const paddingX = () => props.paddingX ?? 2
    const paddingY = () => props.paddingY ?? 1

    const cardSize = createMemo(() => {
        let maxLen = 0
        for (const line of props.lines) {
            if (line.text.length > maxLen) maxLen = line.text.length
        }
        return {
            w: maxLen + paddingX() * 2,
            h: props.lines.length + paddingY() * 2,
        }
    })

    const mask = createMemo(() => {
        const width = Math.max(1, props.width)
        const height = Math.max(1, props.height)
        const { w, h } = cardSize()
        return {
            x: Math.max(0, Math.floor((width - w) / 2)),
            y: Math.max(0, Math.floor((height - h) / 2)),
            w: Math.min(width, w),
            h: Math.min(height, h),
            fade: props.fade ?? 1,
        }
    })

    const resolveColor = (style: BinaryCardLineStyle) => {
        const c = colors()
        switch (style) {
            case "heading":
                return c.primary
            case "muted":
                return c.textMuted
            default:
                return c.text
        }
    }

    return (
        <box
            width={Math.max(1, props.width)}
            height={Math.max(1, props.height)}
            position="relative"
        >
            <BinaryRain
                width={Math.max(1, props.width)}
                height={Math.max(1, props.height)}
                mask={mask()}
                interval={props.interval}
            />
            <box
                position="absolute"
                left={0}
                top={0}
                width={Math.max(1, props.width)}
                height={Math.max(1, props.height)}
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
            >
                <box
                    flexDirection="column"
                    alignItems="center"
                    paddingLeft={paddingX()}
                    paddingRight={paddingX()}
                    paddingTop={paddingY()}
                    paddingBottom={paddingY()}
                    backgroundColor={colors().background}
                >
                    <For each={props.lines}>
                        {(line) => (
                            <text fg={resolveColor(line.style)} wrapMode="none">
                                {line.text}
                            </text>
                        )}
                    </For>
                </box>
            </box>
        </box>
    )
}
