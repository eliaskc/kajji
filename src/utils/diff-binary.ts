export function findBinaryFiles(diffString: string): Set<string> {
    const binaryFiles = new Set<string>()
    const blocks = diffString.split(/\n(?=diff --git )/)

    for (const block of blocks) {
        if (!block.includes("diff --git ")) continue
        // Match binary markers at start of line (not embedded in code)
        if (
            !/^GIT binary patch$/m.test(block) &&
            !/^Binary files /m.test(block)
        )
            continue
        const firstLine = block.split("\n", 1)[0]?.trim()
        if (!firstLine) continue
        const names = parseGitDiffNames(firstLine)
        if (names) {
            // Add both old and new paths to handle renames
            binaryFiles.add(names.oldPath)
            binaryFiles.add(names.newPath)
        }
    }

    return binaryFiles
}

interface DiffPaths {
    oldPath: string
    newPath: string
}

function parseGitDiffNames(line: string): DiffPaths | null {
    if (!line.startsWith("diff --git ")) return null
    const rest = line.slice("diff --git ".length).trim()
    const quotedMatch = rest.match(/^"a\/(.+)"\s+"b\/(.+)"$/)
    if (quotedMatch?.[1] && quotedMatch?.[2]) {
        return { oldPath: quotedMatch[1], newPath: quotedMatch[2] }
    }
    const plainMatch = rest.match(/^a\/(.+)\s+b\/(.+)$/)
    if (plainMatch?.[1] && plainMatch?.[2]) {
        return { oldPath: plainMatch[1], newPath: plainMatch[2] }
    }
    return null
}
