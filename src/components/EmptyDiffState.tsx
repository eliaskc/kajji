import {
    For,
    Show,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
} from "solid-js"

import { useTheme } from "../context/theme"
import { blendColors } from "../utils/color"

interface EmptyDiffStateProps {
    width: number
    height: number
    normalMode?: boolean
}

interface Particle {
    x: number
    y: number
    char: "+" | "−"
    color: string
}

function useAmbientTick(intervalMs = 140) {
    const [tick, setTick] = createSignal(0)

    onMount(() => {
        const interval = setInterval(
            () => setTick((value) => value + 1),
            intervalMs,
        )
        onCleanup(() => clearInterval(interval))
    })

    return tick
}

function EmptyCopy() {
    const { colors } = useTheme()
    return (
        <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            zIndex={2}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
        >
            <box flexDirection="column" alignItems="center">
                <text fg={colors().primary}>NO CHANGES</text>
                <text fg={colors().textMuted}>this revision is empty</text>
            </box>
        </box>
    )
}

function copyAttenuation(x: number, y: number, width: number, height: number) {
    const dx = Math.abs(x - (width - 1) / 2) / 17
    const dy = Math.abs(y - (height - 1) / 2) / 2.2
    const distance = Math.sqrt(dx ** 4 + dy ** 4) ** 0.25
    return Math.max(0, Math.min(1, (distance - 0.72) / 0.42))
}

export function EmptyDiffState(props: EmptyDiffStateProps) {
    const { colors } = useTheme()
    const tick = useAmbientTick()

    const particles = createMemo<Particle[]>(() => {
        const width = Math.max(1, props.width)
        const height = Math.max(1, props.height)
        const topPadding = props.normalMode ? 1 : 0
        const particleHeight = Math.max(0, height - topPadding)
        if (particleHeight === 0) return []
        const particleCount = props.normalMode
            ? Math.max(36, Math.floor((width * particleHeight) / 24))
            : Math.max(90, Math.floor((width * particleHeight) / 15))
        const result: Particle[] = []

        const noise = (seed: number) => {
            const value = Math.sin(seed * 12.9898) * 43758.5453
            return value - Math.floor(value)
        }

        for (let index = 0; index < particleCount; index += 1) {
            const addition = noise(index * 5 + 1) > 0.46
            const speed = 0.065 + noise(index * 5 + 2) * 0.21
            const base = Math.floor(noise(index * 5 + 3) * width)
            const travel = tick() * speed
            const x = addition
                ? Math.floor((base + travel) % width)
                : Math.floor((base - travel + width * 20) % width)
            const y =
                topPadding + Math.floor(noise(index * 5 + 4) * particleHeight)
            const attenuation = props.normalMode
                ? 1
                : copyAttenuation(x, y, width, height)
            if (attenuation < 0.06) continue

            const opacity =
                (0.12 +
                    noise(index * 5 + 5) * 0.16 +
                    (Math.sin(tick() * 0.08 + index * 0.7) + 1) * 0.08) *
                attenuation
            result.push({
                x,
                y,
                char: addition ? "+" : "−",
                color: blendColors(
                    addition
                        ? colors().diff.additionText
                        : colors().diff.deletionText,
                    colors().background,
                    opacity,
                ),
            })
        }

        return result
    })

    return (
        <box
            position="relative"
            width={Math.max(1, props.width)}
            height={Math.max(1, props.height)}
        >
            <For each={particles()}>
                {(particle) => (
                    <text
                        position="absolute"
                        left={particle.x}
                        top={particle.y}
                        fg={particle.color}
                    >
                        {particle.char}
                    </text>
                )}
            </For>
            <Show when={!props.normalMode}>
                <EmptyCopy />
            </Show>
        </box>
    )
}

export function EmptyFilesState() {
    const { colors } = useTheme()

    return (
        <box flexGrow={1} flexDirection="column">
            <text fg={colors().textMuted}>No changed files</text>
        </box>
    )
}
