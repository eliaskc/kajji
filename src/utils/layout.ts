export function getFilesLayoutWeights(width: number) {
    if (width >= 140) return { files: 1, detail: 4 }
    if (width >= 100) return { files: 3, detail: 7 }
    if (width >= 80) return { files: 2, detail: 3 }
    return { files: 1, detail: 1 }
}
