import { useRenderer } from "@opentui/solid"
import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"

function parseHex(hex: string) {
    const h = hex.replace("#", "")
    return {
        r: Number.parseInt(h.slice(0, 2), 16),
        g: Number.parseInt(h.slice(2, 4), 16),
        b: Number.parseInt(h.slice(4, 6), 16),
    }
}

function toHex(r: number, g: number, b: number) {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
    const hex = (n: number) => clamp(n).toString(16).padStart(2, "0")
    return `#${hex(r)}${hex(g)}${hex(b)}`
}

function lerpColor(from: string, to: string, t: number) {
    const f = parseHex(from)
    const c = parseHex(to)
    return toHex(
        f.r + (c.r - f.r) * t,
        f.g + (c.g - f.g) * t,
        f.b + (c.b - f.b) * t,
    )
}

interface Stream {
    head: number
    speed: number
    length: number
    chars: string[]
    offsetTick: number
    gapBelow: number
}

const BODY_CHARS = ["0", "1", "0", "1", "0", "1", "▓", "▒", "░"]
const HEAD_CHARS = ["0", "1"]

function pickBody() {
    return BODY_CHARS[Math.floor(Math.random() * BODY_CHARS.length)] ?? "0"
}

function pickHead() {
    return HEAD_CHARS[Math.floor(Math.random() * HEAD_CHARS.length)] ?? "0"
}

function makeStream(height: number, tick: number, fresh: boolean): Stream {
    const maxLen = Math.max(6, Math.floor(height * 0.6))
    const minLen = Math.max(4, Math.floor(height * 0.15))
    return {
        head: fresh
            ? -Math.floor(Math.random() * Math.max(1, height))
            : -1 - Math.floor(Math.random() * 3),
        speed: 1 + Math.floor(Math.random() * 4),
        length:
            minLen + Math.floor(Math.random() * Math.max(1, maxLen - minLen)),
        chars: [pickHead()],
        offsetTick: tick - Math.floor(Math.random() * 4),
        gapBelow: Math.floor(
            Math.random() * Math.max(1, Math.floor(height / 3)),
        ),
    }
}

export interface BinaryRainProps {
    width: number
    height: number
    /** Rectangular carve-out region where the rain is suppressed (e.g. for a label on top). */
    mask?: {
        x: number
        y: number
        w: number
        h: number
        /** Extra cells around the rect where the rain fades out (default 1). */
        fade?: number
    }
    /** Tick interval in milliseconds (default 160). */
    interval?: number
}

export function BinaryRain(props: BinaryRainProps) {
    const renderer = useRenderer()
    const { colors } = useTheme()
    const [tick, setTick] = createSignal(0)

    // Per-column stream state persists across ticks
    let streams: Stream[] = []
    let lastWidth = 0
    let lastHeight = 0

    onMount(() => {
        const intervalMs = props.interval ?? 160
        const interval = setInterval(() => setTick((t) => t + 1), intervalMs)
        onCleanup(() => clearInterval(interval))
        // Nudge repaints to follow renderer resize so the effect stays live
        const handleResize = () => setTick((t) => t + 1)
        renderer.on("resize", handleResize)
        onCleanup(() => renderer.off("resize", handleResize))
    })

    const rows = createMemo(() => {
        const width = Math.max(1, props.width)
        const height = Math.max(1, props.height)
        const t = tick()

        if (width !== lastWidth || height !== lastHeight) {
            streams = []
            for (let i = 0; i < width; i += 1) {
                streams.push(makeStream(height, t, true))
            }
            lastWidth = width
            lastHeight = height
        }

        // Advance streams
        for (let x = 0; x < width; x += 1) {
            const s = streams[x]
            if (!s) continue
            if ((t - s.offsetTick) % s.speed !== 0) continue
            s.head += 1
            s.chars.unshift(pickHead())
            // Occasionally mutate a trailing char for texture / glitch
            if (Math.random() < 0.06 && s.chars.length > 1) {
                const idx = 1 + Math.floor(Math.random() * (s.chars.length - 1))
                s.chars[idx] = pickBody()
            }
            if (s.chars.length > s.length) s.chars.length = s.length
            if (s.head - s.length > height + s.gapBelow) {
                streams[x] = makeStream(height, t, false)
            }
        }

        const bg = colors().background
        const body = colors().primary
        const headColor = colors().text
        const muted = colors().textMuted
        const mask = props.mask
        const fade = mask?.fade ?? 1

        const grid: Array<Array<{ char: string; color: string } | null>> = []
        for (let y = 0; y < height; y += 1) {
            grid.push(new Array(width).fill(null))
        }

        for (let x = 0; x < width; x += 1) {
            const s = streams[x]
            if (!s) continue
            for (let i = 0; i < s.chars.length; i += 1) {
                const y = s.head - i
                if (y < 0 || y >= height) continue

                // Rectangular mask carve-out. Hard-skip inside the rect, and
                // attenuate in a small fade border so edges don't look sliced.
                let maskAttenuation = 1
                if (mask) {
                    const insideX = x >= mask.x && x < mask.x + mask.w
                    const insideY = y >= mask.y && y < mask.y + mask.h
                    if (insideX && insideY) continue
                    if (fade > 0) {
                        const dx =
                            x < mask.x
                                ? mask.x - x
                                : x >= mask.x + mask.w
                                  ? x - (mask.x + mask.w - 1)
                                  : 0
                        const dy =
                            y < mask.y
                                ? mask.y - y
                                : y >= mask.y + mask.h
                                  ? y - (mask.y + mask.h - 1)
                                  : 0
                        // Chebyshev-ish distance, treating y as ~2x closer (cell aspect)
                        const d = Math.max(dx, dy * 2)
                        if (d <= fade) {
                            maskAttenuation = (d / (fade + 1)) ** 1.5
                        }
                    }
                }
                if (maskAttenuation <= 0.02) continue

                const ch = s.chars[i]
                if (!ch) continue

                const tPos = s.length > 1 ? i / (s.length - 1) : 0
                let color: string
                if (i === 0) {
                    color = lerpColor(bg, headColor, 0.95 * maskAttenuation)
                } else if (tPos < 0.25) {
                    // Bright hot zone right behind head
                    const sub = tPos / 0.25
                    const hot = lerpColor(headColor, body, sub)
                    color = lerpColor(bg, hot, 0.85 * maskAttenuation)
                } else {
                    // Long tail fading into muted then background
                    const sub = (tPos - 0.25) / 0.75
                    const trail = lerpColor(body, muted, sub)
                    const intensity = (1 - sub) ** 1.6 * 0.65 * maskAttenuation
                    color = lerpColor(bg, trail, intensity)
                }

                const gridRow = grid[y]
                if (gridRow) gridRow[x] = { char: ch, color }
            }
        }

        return grid
    })

    return (
        <box
            position="absolute"
            left={0}
            top={0}
            width={Math.max(1, props.width)}
            height={Math.max(1, props.height)}
        >
            <For each={rows()}>
                {(row) => (
                    <text wrapMode="none">
                        <For each={row}>
                            {(cell) =>
                                cell ? (
                                    <span style={{ fg: cell.color }}>
                                        {cell.char}
                                    </span>
                                ) : (
                                    <span> </span>
                                )
                            }
                        </For>
                    </text>
                )}
            </For>
        </box>
    )
}
