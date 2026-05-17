/**
 * Creates a double-click detector that distinguishes single vs double clicks.
 *
 * @param onSingleClick - Called on single click (after timeout confirms no second click)
 * @param onDoubleClick - Called on double click
 * @param timeout - Max time between clicks to count as double-click (default: 300ms)
 */
export function createDoubleClickHandler(
    onSingleClick?: () => void,
    onDoubleClick?: () => void,
    timeout = 300,
): () => void {
    let lastClickTime = 0
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null

    return () => {
        const now = Date.now()
        const timeSinceLastClick = now - lastClickTime

        if (pendingTimeout) {
            clearTimeout(pendingTimeout)
            pendingTimeout = null
        }

        if (timeSinceLastClick < timeout) {
            lastClickTime = 0
            onDoubleClick?.()
        } else {
            lastClickTime = now
            if (onSingleClick) {
                pendingTimeout = setTimeout(() => {
                    pendingTimeout = null
                    onSingleClick()
                }, timeout)
            }
        }
    }
}

/**
 * Simpler version that only detects double-clicks (no single-click delay).
 * Use this when you don't need to distinguish single clicks.
 */
export function createDoubleClickDetector(
    onDoubleClick: () => void,
    timeout = 300,
): () => void {
    let lastClickTime = 0

    return () => {
        const now = Date.now()
        if (now - lastClickTime < timeout) {
            lastClickTime = 0
            onDoubleClick()
        } else {
            lastClickTime = now
        }
    }
}
