import type { ProcessEventMap } from "node:process"

// bun-types 1.4 adds `memoryPressure` overloads for `on` and `once` on
// `NodeJS.Process`. With @types/node 25+, these overloads hide the typed
// signatures that `Process` inherits, so every other event name fails to
// type-check. Declare the typed signatures again so that both stay visible.
declare global {
    namespace NodeJS {
        interface Process {
            on<E extends keyof ProcessEventMap>(
                event: E,
                listener: (...args: ProcessEventMap[E]) => void,
            ): this
            once<E extends keyof ProcessEventMap>(
                event: E,
                listener: (...args: ProcessEventMap[E]) => void,
            ): this
        }
    }
}
