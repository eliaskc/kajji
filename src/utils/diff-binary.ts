export function findBinaryFiles(diffString: string): Set<string> {
    const binaryFiles = new Set<string>()
    const blocks = diffString.split(/\n(?=diff --git )/)

    for (const block of blocks) {
        if (!block.includes("diff --git ")) continue
        // Match binary markers at start of line (not embedded in code)
        if (!/^GIT binary patch$/m.test(block) && !/^Binary files /m.test(block)) continue
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

// Git quotes each side of the header independently and C-escapes special
// characters. Decode the names so that they match the names that
// @pierre/diffs reports.
function parseGitDiffNames(line: string): DiffPaths | null {
    if (!line.startsWith("diff --git ")) return null
    const rest = line.slice("diff --git ".length).trim()

    if (rest.startsWith('"')) {
        const oldQuoted = parseQuotedName(rest)
        if (!oldQuoted) return null
        const newToken = rest.slice(oldQuoted.rawLength).trimStart()
        const newPath = newToken.startsWith('"') ? parseQuotedName(newToken)?.name : newToken
        return toDiffPaths(oldQuoted.name, newPath)
    }

    const quotedNewMatch = rest.match(/^(a\/.+?)\s+("b\/.*")$/)
    if (quotedNewMatch?.[1] && quotedNewMatch[2]) {
        return toDiffPaths(quotedNewMatch[1], parseQuotedName(quotedNewMatch[2])?.name)
    }

    const plainMatch = rest.match(/^(a\/.+)\s+(b\/.+)$/)
    return toDiffPaths(plainMatch?.[1], plainMatch?.[2])
}

function toDiffPaths(oldName: string | undefined, newName: string | undefined): DiffPaths | null {
    if (!oldName?.startsWith("a/") || !newName?.startsWith("b/")) return null
    const oldPath = oldName.slice(2)
    const newPath = newName.slice(2)
    if (!oldPath || !newPath) return null
    return { oldPath, newPath }
}

const NAMED_ESCAPES: Record<string, string> = {
    '"': '"',
    "\\": "\\",
    a: "\x07",
    b: "\b",
    t: "\t",
    n: "\n",
    v: "\v",
    f: "\f",
    r: "\r",
}

const utf8Decoder = new TextDecoder("utf-8", { ignoreBOM: true })

// Reads one C-quoted name. Adjacent octal escapes are UTF-8 bytes, so decode
// them together.
function parseQuotedName(input: string): { name: string; rawLength: number } | null {
    if (input[0] !== '"') return null
    let name = ""
    let index = 1
    while (index < input.length) {
        const char = input[index]!
        if (char === '"') return { name, rawLength: index + 1 }
        if (char !== "\\") {
            name += char
            index++
            continue
        }
        const named = NAMED_ESCAPES[input[index + 1] ?? ""]
        if (named !== undefined) {
            name += named
            index += 2
            continue
        }
        const bytes: number[] = []
        while (input[index] === "\\" && /^[0-3][0-7]{2}$/.test(input.slice(index + 1, index + 4))) {
            bytes.push(Number.parseInt(input.slice(index + 1, index + 4), 8))
            index += 4
        }
        if (bytes.length === 0) return null
        name += utf8Decoder.decode(new Uint8Array(bytes))
    }
    return null
}
