import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"

export type StatusMessageKind = "info" | "success" | "error"

export interface StatusMessage {
    id: string
    text: string
    kind: StatusMessageKind
}

export interface ShowStatusMessageOptions {
    kind?: StatusMessageKind
    duration?: number
}

export const { use: useStatus, provider: StatusProvider } = createSimpleContext(
    {
        name: "Status",
        init: () => {
            const [message, setMessage] = createSignal<StatusMessage | null>(
                null,
            )
            let timeout: ReturnType<typeof setTimeout> | undefined

            const clearTimeoutIfNeeded = () => {
                if (!timeout) return
                clearTimeout(timeout)
                timeout = undefined
            }

            const clear = (id?: string) => {
                if (id && message()?.id !== id) return
                clearTimeoutIfNeeded()
                setMessage(null)
            }

            const show = (
                text: string,
                options: ShowStatusMessageOptions = {},
            ) => {
                clearTimeoutIfNeeded()
                const id = crypto.randomUUID()
                setMessage({ id, text, kind: options.kind ?? "info" })

                const duration = options.duration ?? 2000
                if (duration > 0) {
                    timeout = setTimeout(() => clear(id), duration)
                }

                return id
            }

            onCleanup(clearTimeoutIfNeeded)

            return {
                message,
                show,
                clear,
            }
        },
    },
)
