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

const directionalWaves = [
	{ angle: 0.3, freq: 0.06, speed: 0.03, amp: 0.35, twist: 0.002 },
	{ angle: 0.15, freq: 0.04, speed: -0.02, amp: 0.25, twist: -0.003 },
	{ angle: 0.5, freq: 0.08, speed: 0.04, amp: 0.2, twist: 0.001 },
]

const radialWaves = [
	{ freq: 0.1, speed: 0.025, amp: 0.3, drift: 0.008 },
	{ freq: 0.07, speed: -0.02, amp: 0.25, drift: -0.005 },
]

export interface WaveBackgroundProps {
	peakColor?: string
	/** Peak intensity multiplier (default 0.5, higher = stronger color) */
	peakOpacity?: number
}

export function WaveBackground(props: WaveBackgroundProps) {
	const renderer = useRenderer()
	const { colors, mode } = useTheme()
	const [tick, setTick] = createSignal(0)
	const [dimensions, setDimensions] = createSignal({
		width: renderer.width,
		height: renderer.height,
	})

	onMount(() => {
		const interval = setInterval(() => setTick((t) => t + 1), 16)
		onCleanup(() => clearInterval(interval))

		const handleResize = (w: number, h: number) =>
			setDimensions({ width: w, height: h })
		renderer.on("resize", handleResize)
		onCleanup(() => renderer.off("resize", handleResize))
	})

	const getIntensity = (
		x: number,
		y: number,
		t: number,
		w: number,
		h: number,
	) => {
		let total = 0
		let totalAmp = 0

		for (const wave of directionalWaves) {
			const a = wave.angle + Math.sin(t * wave.twist) * 0.3
			const val = Math.sin((x * a + y) * wave.freq + t * wave.speed) * 0.5 + 0.5
			total += val * wave.amp
			totalAmp += wave.amp
		}

		for (const wave of radialWaves) {
			const cx = w / 2 + Math.sin(t * wave.drift) * w * 0.3
			const cy = h / 2 + Math.cos(t * wave.drift * 1.3) * h * 0.3
			const dist = Math.sqrt((x - cx) ** 2 + ((y - cy) * 2) ** 2)
			const val = Math.sin(dist * wave.freq - t * wave.speed) * 0.5 + 0.5
			total += val * wave.amp
			totalAmp += wave.amp
		}

		return Math.max(0.03, (total / totalAmp) ** 1.5)
	}

	const rows = createMemo(() => {
		const { width, height } = dimensions()
		const t = tick()
		const bg = colors().background
		const peak = props.peakColor ?? colors().primary
		const opacity = props.peakOpacity ?? (mode() === "light" ? 0.85 : 0.5)

		const result: string[][] = []
		for (let y = 0; y < height; y++) {
			const row: string[] = []
			for (let x = 0; x < width; x++) {
				row.push(
					lerpColor(bg, peak, getIntensity(x, y, t, width, height) * opacity),
				)
			}
			result.push(row)
		}
		return result
	})

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width={dimensions().width}
			height={dimensions().height}
		>
			<For each={rows()}>
				{(row) => (
					<text>
						<For each={row}>
							{(color) => <span style={{ fg: color }}>█</span>}
						</For>
					</text>
				)}
			</For>
		</box>
	)
}
