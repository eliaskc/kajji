export interface DialogHint {
    key: string
    label: string
    order?: number
}

export function mergeDialogHints(
    staticHints: readonly DialogHint[],
    generatedHints: readonly DialogHint[],
): DialogHint[] {
    const merged = [...staticHints, ...generatedHints]
        .map((hint, index) => ({ hint, index }))
        .sort(
            (a, b) =>
                (a.hint.order ?? Number.MAX_SAFE_INTEGER) -
                    (b.hint.order ?? Number.MAX_SAFE_INTEGER) ||
                a.index - b.index,
        )

    const seen = new Set<string>()
    return merged.flatMap(({ hint }) => {
        const identity = `${hint.key}\0${hint.label}`
        if (seen.has(identity)) return []
        seen.add(identity)
        return [hint]
    })
}
