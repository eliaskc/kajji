/**
 * Creates a detector that calls onDoubleClick when two clicks occur within the timeout.
 */
export function createDoubleClickDetector(onDoubleClick: () => void, timeout = 300): () => void {
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
