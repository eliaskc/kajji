import type { BookmarkResetMode, BookmarkResetPlan } from "../application/bookmark-reset"

function pronouns(count: number) {
    return count === 1
        ? { object: "it", possessive: "its", verb: "is", has: "has" }
        : { object: "them", possessive: "their", verb: "are", has: "have" }
}

/** Question above the reset menu, in plain words. */
export function resetMenuSummary(plan: BookmarkResetPlan) {
    const count = plan.localOnly.length
    const words = pronouns(count)
    const commits = `${count} local commit${count === 1 ? "" : "s"}`
    const sameContent = plan.sameContent ? ", but the content is the same" : ""
    return `${commits} ${words.verb} not on origin${sameContent}. What do you want to do with ${words.object}?`
}

/** Warning below the reset menu, or undefined when nothing else changes. */
export function resetMenuFooter(plan: BookmarkResetPlan) {
    const { object } = pronouns(plan.localOnly.length)
    if (plan.affectsWorkingCopy) {
        return `Note: @ is based on ${object}, so abandoning ${object} rebases @.`
    }
    if (plan.descendants > 0) {
        const others =
            plan.descendants === 1 ? "1 other commit is" : `${plan.descendants} other commits are`
        return `Note: ${others} based on ${object}, so abandoning ${object} rebases them.`
    }
    return undefined
}

export function resetMenuOption(plan: BookmarkResetPlan, mode: BookmarkResetMode) {
    const { object, possessive } = pronouns(plan.localOnly.length)
    const mutedPrefix = "reset and "
    if (mode === "abandon") return { key: "a", mutedPrefix, label: `abandon ${object}` }
    if (mode === "keep") return { key: "k", mutedPrefix, label: `keep ${object}` }
    return { key: "n", mutedPrefix, label: `keep ${possessive} changes as a new commit` }
}
