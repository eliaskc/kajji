import type { OperationResult } from "../process/operation-result"

const BOOKMARK_MARKER = "__BJ__"
const BOOKMARK_DESCRIPTION =
    'if(normal_target, if(normal_target.empty(), label("empty", "(empty) "), "") ++ if(normal_target.description().first_line(), normal_target.description().first_line(), label("description placeholder", "(no description set)")), "")'

const BOOKMARK_FIELDS = [
    `"${BOOKMARK_MARKER}"`,
    "name",
    `"${BOOKMARK_MARKER}"`,
    'label("bookmark name", name)',
    `"${BOOKMARK_MARKER}"`,
    'if(remote, remote, "")',
    `"${BOOKMARK_MARKER}"`,
    'pad_end(8, truncate_end(8, coalesce(if(normal_target, format_short_change_id(normal_target.change_id()), ""), self.added_targets().map(|c| format_short_change_id(c.change_id())).join(","), self.removed_targets().map(|c| format_short_change_id(c.change_id())).join(","))))',
    `"${BOOKMARK_MARKER}"`,
    'coalesce(if(normal_target, format_short_commit_id(normal_target.commit_id()), ""), self.added_targets().map(|c| format_short_commit_id(c.commit_id())).join(","), self.removed_targets().map(|c| format_short_commit_id(c.commit_id())).join(","))',
    `"${BOOKMARK_MARKER}"`,
    'coalesce(if(normal_target, normal_target.change_id(), ""), self.added_targets().map(|c| c.change_id()).join(","), self.removed_targets().map(|c| c.change_id()).join(","))',
    `"${BOOKMARK_MARKER}"`,
    'coalesce(if(normal_target, normal_target.commit_id(), ""), self.added_targets().map(|c| c.commit_id()).join(","), self.removed_targets().map(|c| c.commit_id()).join(","))',
    `"${BOOKMARK_MARKER}"`,
    `coalesce(${BOOKMARK_DESCRIPTION}, self.added_targets().map(|c| if(c.empty(), label("empty", "(empty) "), "") ++ if(c.description().first_line(), c.description().first_line(), label("description placeholder", "(no description set)"))).join(", "), self.removed_targets().map(|c| if(c.empty(), label("empty", "(empty) "), "") ++ if(c.description().first_line(), c.description().first_line(), label("description placeholder", "(no description set)"))).join(", "))`,
    '"\\n"',
]

export const BOOKMARK_TEMPLATE = BOOKMARK_FIELDS.join(" ++ ")

// Read reference identity separately from target formatting. Several local and
// remote references can share one target, whose empty check can be expensive.
export const BOOKMARK_REFERENCE_TEMPLATE = [...BOOKMARK_FIELDS.slice(0, -2), '"\\n"'].join(" ++ ")

const BOOKMARK_DESCRIPTION_TEMPLATE = [
    `"${BOOKMARK_MARKER}${BOOKMARK_MARKER}${BOOKMARK_MARKER}${BOOKMARK_MARKER}${BOOKMARK_MARKER}${BOOKMARK_MARKER}${BOOKMARK_MARKER}"`,
    'if(normal_target, normal_target.commit_id(), "")',
    `"${BOOKMARK_MARKER}"`,
    BOOKMARK_DESCRIPTION,
    '"\\n"',
].join(" ++ ")

export interface BookmarkTargetRead {
    remote: string
    names: string[]
}

export function groupBookmarkTargetReads(references: readonly Bookmark[]): BookmarkTargetRead[] {
    const representatives = new Map<string, Bookmark>()
    // Prefer local references so shared targets usually fit in one remote group.
    for (const reference of references) {
        if (!representatives.has(reference.commitId) || reference.isLocal) {
            representatives.set(reference.commitId, reference)
        }
    }
    const byRemote = new Map<string, Bookmark[]>()
    for (const reference of representatives.values()) {
        const remote = reference.remote ?? ""
        const group = byRemote.get(remote) ?? []
        group.push(reference)
        byRemote.set(remote, group)
    }
    const result: BookmarkTargetRead[] = []
    const encoder = new TextEncoder()
    for (const [remote, references] of byRemote) {
        let names: string[] = []
        let bytes = 0
        for (const reference of references) {
            const size = encoder.encode(reference.name).length + 7
            if (names.length && (names.length >= 256 || bytes + size > 16_384)) {
                result.push({ remote, names })
                names = []
                bytes = 0
            }
            names.push(reference.name)
            bytes += size
        }
        if (names.length) result.push({ remote, names })
    }
    return result
}

export function bookmarkTargetTemplate(remote: string): string {
    // Keep bookmark_list label scope and user template aliases exactly as in the
    // original read. Using `jj log` here would change scoped user colors.
    return `if(stringify(remote) == ${JSON.stringify(remote)}, (${BOOKMARK_DESCRIPTION_TEMPLATE}), "")`
}

export function createBookmarkTargetAccumulator(references: readonly Bookmark[]) {
    const byCommit = new Map<string, Bookmark>()
    const result: Bookmark[] = []
    return {
        add(targets: readonly Bookmark[]): Bookmark[] | undefined {
            for (const target of targets) byCommit.set(target.commitId, target)
            const previousLength = result.length
            while (result.length < references.length) {
                const reference = references[result.length]!
                const target = byCommit.get(reference.commitId)
                if (!target) break
                result.push({
                    ...reference,
                    description: target.description,
                    descriptionDisplay: target.descriptionDisplay,
                })
            }
            // Only publish a fully resolved prefix, in the original reference
            // order. Later batches must not mutate earlier snapshots.
            return result.length > previousLength ? result.slice() : undefined
        },
        complete(): Bookmark[] | undefined {
            return result.length === references.length ? result.slice() : undefined
        },
    }
}

export function applyBookmarkTargets(
    references: readonly Bookmark[],
    targets: readonly Bookmark[],
): Bookmark[] | undefined {
    const accumulator = createBookmarkTargetAccumulator(references)
    accumulator.add(targets)
    return accumulator.complete()
}

// oxlint-disable-next-line no-control-regex -- intentional ANSI escape sequence
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

export interface Bookmark {
    name: string
    nameDisplay: string
    changeId: string
    commitId: string
    changeIdDisplay: string
    commitIdDisplay: string
    descriptionDisplay: string
    description: string
    isLocal: boolean
    remote?: string
}

export function parseBookmarkOutput(output: string): Bookmark[] {
    const bookmarks: Bookmark[] = []

    for (const line of output.split("\n")) {
        if (!line.includes(BOOKMARK_MARKER)) continue
        const parts = line.split(BOOKMARK_MARKER)
        if (parts.length < 9) continue

        const name = stripAnsi(parts[1] ?? "")
        const nameDisplay = parts[2] ?? ""
        const remote = stripAnsi(parts[3] ?? "")
        const changeIdDisplay = parts[4] ?? ""
        const commitIdDisplay = parts[5] ?? ""
        const changeId = stripAnsi(parts[6] ?? "")
        const commitId = stripAnsi(parts[7] ?? "")
        const descriptionDisplay = parts[8] ?? ""
        const isLocal = remote.length === 0

        bookmarks.push({
            name,
            nameDisplay,
            changeId,
            commitId,
            changeIdDisplay,
            commitIdDisplay,
            descriptionDisplay,
            description: stripAnsi(descriptionDisplay).trim(),
            isLocal,
            remote: isLocal ? undefined : remote,
        })
    }

    return bookmarks
}

export function isBookmarkBackwardsError(result: OperationResult): boolean {
    if (result.success) return false
    const combined = `${result.stdout}\n${result.stderr}`
    return /allow-backwards/i.test(combined) || /backward/i.test(combined)
}
