import { createEffect, on, onCleanup } from "solid-js"
import type { UntrackedLargeFile } from "../commander/snapshot-warnings"
import { useCommandLog } from "../context/commandlog"
import { useSync } from "../context/sync"
import {
    untrackedLargeFilesClearedMessage,
    untrackedLargeFilesWarning,
} from "../utils/untracked-large-files"

/**
 * Write to the command log when jj refuses large files.
 * - Commands the user runs (e.g. `jj new`): the log removes jj's raw block from the
 *   command output, so the full entry follows the command every time.
 * - Background refresh: jj repeats its warning on every snapshot, so only paths new
 *   to the log make an entry.
 */
export function useUntrackedLargeFilesLog() {
    const { untrackedLargeFiles } = useSync()
    const commandLog = useCommandLog()
    const announced = new Map<string, UntrackedLargeFile>()

    const announce = (files: readonly UntrackedLargeFile[]) => {
        if (files.length === 0) return
        for (const file of files) announced.set(file.path, file)
        const { message, output } = untrackedLargeFilesWarning(files)
        commandLog.warn(message, output)
    }

    onCleanup(commandLog.onRefusedSnapshotFiles(announce))

    createEffect(
        on(untrackedLargeFiles, (next) => {
            const nextPaths = new Set(next.map((file) => file.path))
            const cleared = [...announced.values()].filter((file) => !nextPaths.has(file.path))
            for (const file of cleared) announced.delete(file.path)
            announce(next.filter((file) => !announced.has(file.path)))
            if (cleared.length > 0) commandLog.info(untrackedLargeFilesClearedMessage(cleared))
        }),
    )
}
