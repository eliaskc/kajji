import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../../context/theme"

interface StackPreparingModalProps {
    kind: "sync"
    stackRootName: string
}

const WIDTH = 44
const HEIGHT = 11
const glyphs = [" ", "░", "▒", "▓", "█"]

const loadingMessages = [
    "Consulting the GitHub oracles…",
    "Surveying the stacklands…",
    "Charting your stack…",
    "Reading the GitHub runes…",
    "Assembling the stack map…",
    "Scouting PR terrain…",
    "Tracing stack paths…",
    "Inspecting the stack ley lines…",
    "Gathering stack omens…",
    "Preparing your stack…",
    "Polling the pull request spirits…",
    "Following bookmark trails…",
    "Mapping GitHub foothills…",
    "Decoding stack whispers…",
    "Aligning the PR constellations…",
    "Reading the branch weather…",
    "Summoning a stack plan…",
    "Checking the review currents…",
    "Walking the stack graph…",
    "Unfurling the PR parchment…",
]

function randomLoadingMessage() {
    return (
        loadingMessages[Math.floor(Math.random() * loadingMessages.length)] ??
        "Preparing your stack…"
    )
}

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

export function StackPreparingModal(props: StackPreparingModalProps) {
    const { colors } = useTheme()
    const [tick, setTick] = createSignal(0)
    const [message] = createSignal(randomLoadingMessage())

    onMount(() => {
        const interval = setInterval(() => setTick((value) => value + 1), 90)
        onCleanup(() => clearInterval(interval))
    })

    const rows = createMemo(() => {
        const t = tick()
        const pulse = 1 + Math.sin(t * 0.22) * 0.08
        const cx = WIDTH / 2 - 0.5
        const cy = HEIGHT / 2 - 0.5
        const rx = 18 * pulse
        const ry = 4.4 * pulse
        const bg = colors().background
        const primary = colors().primary

        return Array.from({ length: HEIGHT }, (_, y) =>
            Array.from({ length: WIDTH }, (_, x) => {
                const nx = (x - cx) / rx
                const ny = (y - cy) / ry
                const r = Math.sqrt(nx * nx + ny * ny)
                if (r > 1.08) return { char: " ", color: bg }

                const base = Math.max(0, 1 - r)
                const upperLight = Math.max(0, 1 - Math.abs(ny + 0.34) * 2.2)
                const lowerFade = Math.max(0, 1 - Math.abs(ny - 0.42) * 3.2)
                const band = Math.sin(x * 0.34 - y * 0.7 + t * 0.38) * 0.5 + 0.5
                const shimmer =
                    Math.sin(x * 0.72 + y * 0.28 - t * 0.75) * 0.5 + 0.5
                const edgeFade = Math.max(0, Math.min(1, (1.08 - r) / 0.28))
                const intensity = Math.max(
                    0,
                    Math.min(
                        1,
                        (base ** 0.32 * 0.68 +
                            upperLight * 0.28 +
                            lowerFade * 0.12 +
                            band * 0.16 +
                            shimmer * 0.12) *
                            edgeFade,
                    ),
                )
                const glyphIndex = Math.max(
                    1,
                    Math.min(4, Math.floor(intensity * 4.5)),
                )
                return {
                    char: glyphs[glyphIndex] ?? "░",
                    color: lerpColor(bg, primary, 0.25 + intensity * 0.75),
                }
            }),
        )
    })

    return (
        <box
            flexDirection="column"
            flexGrow={1}
            justifyContent="center"
            alignItems="center"
            paddingTop={1}
            gap={1}
        >
            <box flexDirection="column" alignItems="center">
                <For each={rows()}>
                    {(row) => (
                        <text wrapMode="none">
                            <For each={row}>
                                {(cell) => (
                                    <span style={{ fg: cell.color }}>
                                        {cell.char}
                                    </span>
                                )}
                            </For>
                        </text>
                    )}
                </For>
            </box>
            <box height={1} />
            <text wrapMode="none" fg={colors().text}>
                {message()}
            </text>
        </box>
    )
}
