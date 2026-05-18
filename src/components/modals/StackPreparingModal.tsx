import { createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../../context/theme"

interface StackPreparingModalProps {
    kind: "submit" | "sync"
    stackRootName: string
}

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const waveGlyphs = [
    "▁",
    "▂",
    "▃",
    "▄",
    "▅",
    "▆",
    "▇",
    "█",
    "▇",
    "▆",
    "▅",
    "▄",
    "▃",
    "▂",
]

export function StackPreparingModal(props: StackPreparingModalProps) {
    const { colors } = useTheme()
    const [tick, setTick] = createSignal(0)

    onMount(() => {
        const interval = setInterval(() => setTick((value) => value + 1), 80)
        onCleanup(() => clearInterval(interval))
    })

    const label = () =>
        props.kind === "submit"
            ? "Preparing submit plan"
            : "Preparing sync plan"
    const wave = () =>
        Array.from({ length: 24 }, (_, index) => {
            const offset = (index + tick()) % waveGlyphs.length
            return waveGlyphs[offset]
        }).join("")

    return (
        <box flexDirection="column" minHeight={10} justifyContent="center">
            <box flexDirection="column" alignItems="center" gap={1}>
                <text wrapMode="none" fg={colors().primary}>
                    {frames[tick() % frames.length]} {label()}
                </text>
                <text wrapMode="none" fg={colors().textMuted}>
                    {props.stackRootName}
                </text>
                <text wrapMode="none" fg={colors().primary}>
                    {wave()}
                </text>
                <text wrapMode="none" fg={colors().textMuted}>
                    Fetching jj and GitHub state…
                </text>
            </box>
        </box>
    )
}
