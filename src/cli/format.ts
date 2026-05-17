export function formatLineRange(
    oldStart: number,
    oldCount: number,
    newStart: number,
    newCount: number,
): string {
    const useNew = newCount > 0
    const start = useNew ? newStart : oldStart
    const count = useNew ? newCount : oldCount
    const end = Math.max(start, start + Math.max(count, 1) - 1)
    return `${start}-${end}`
}
