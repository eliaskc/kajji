import { onAnimationTick } from "@opentui/solid"
import { type Accessor, createSignal } from "solid-js"

/**
 * A counter that advances `fps` times per second on OpenTUI's shared animation clock.
 * Animations at different rates share frames instead of each requesting their own.
 * While `active` returns false the animation is unsubscribed and requests no frames.
 */
export function createAnimationTick(fps: number, active: Accessor<boolean> = () => true) {
    const [tick, setTick] = createSignal(0)
    onAnimationTick(
        () => (active() ? fps : undefined),
        // `ticks` is above 1 after a stalled frame, so the animation keeps wall-clock pace.
        (_deltaTime, ticks) => setTick((value) => value + ticks),
    )
    return tick
}
