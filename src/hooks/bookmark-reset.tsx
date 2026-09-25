import {
    type BookmarkResetMode,
    type BookmarkResetPlan,
    availableResetModes,
    planBookmarkReset,
    runBookmarkReset,
} from "../application/bookmark-reset"
import { ActionMenuModal } from "../components/modals/ActionMenuModal"
import { useApplication } from "../context/application"
import { useCommandLog } from "../context/commandlog"
import { DIALOG_SIZE, useDialog } from "../context/dialog"
import { useStatus } from "../context/status"
import { useSync } from "../context/sync"
import { getRepoPath } from "../repo"
import {
    findOriginBookmark,
    resetToOriginConfirmMessage,
    resetToOriginUnavailableReason,
} from "../utils/bookmark-origin-diff"
import { resetMenuFooter, resetMenuOption, resetMenuSummary } from "../utils/bookmark-reset-copy"

/**
 * Returns a function that resets a local bookmark to its origin target. When
 * the local bookmark has commits that origin does not have, it opens a menu:
 * abandon them, keep their changes as a new commit on origin, or leave them.
 */
export function useBookmarkReset() {
    const app = useApplication()
    const dialog = useDialog()
    const commandLog = useCommandLog()
    const status = useStatus()
    const { bookmarks } = useSync()

    return async (name: string, onSuccess?: () => void | Promise<void>) => {
        const all = bookmarks()
        const local = all.find((bookmark) => bookmark.isLocal && bookmark.name === name)
        const reason = resetToOriginUnavailableReason(local, all)
        const origin = findOriginBookmark(name, all)
        if (reason || !local || !origin) {
            status.show(`Cannot reset ${name}: ${reason ?? "has no origin bookmark"}.`)
            return
        }

        const cwd = getRepoPath()
        let plan: BookmarkResetPlan
        try {
            plan = await planBookmarkReset(app, local, origin, { cwd })
        } catch (error) {
            commandLog.addEntry({
                command: "reset to origin",
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
            })
            return
        }
        if (getRepoPath() !== cwd) return

        const execute = async (mode: BookmarkResetMode) => {
            const result = await runBookmarkReset(
                app,
                plan,
                mode,
                (op) => op(commandLog.observer()),
                { cwd },
            )
            commandLog.addEntry(result)
            if (result.success) await onSuccess?.()
        }

        const modes = availableResetModes(plan)
        if (modes.length === 1) {
            const confirmed = await dialog.confirm({
                ...DIALOG_SIZE.confirmWide,
                message: resetToOriginConfirmMessage(name),
            })
            if (confirmed) await execute(modes[0] as BookmarkResetMode)
            return
        }

        dialog.open(
            () => (
                <ActionMenuModal
                    summary={resetMenuSummary(plan)}
                    footer={resetMenuFooter(plan)}
                    options={modes.map((mode) => ({
                        ...resetMenuOption(plan, mode),
                        onSelect: () => void execute(mode),
                    }))}
                />
            ),
            {
                id: "bookmark-reset-menu",
                title: [
                    { text: "Reset", style: "action" },
                    " ",
                    { text: name, style: "target" },
                    " to origin",
                ],
                ...DIALOG_SIZE.confirmWide,
            },
        )
    }
}
