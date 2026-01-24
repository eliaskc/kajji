import type { ThemeColors } from "../theme/types"

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied"
export type DiffFileStatus =
	| "new"
	| "deleted"
	| "rename-pure"
	| "rename-changed"
	| "change"

export function getStatusColor(
	status: FileStatus,
	colors: ThemeColors,
): string {
	switch (status) {
		case "added":
			return colors.success
		case "modified":
			return colors.warning
		case "deleted":
			return colors.error
		case "renamed":
		case "copied":
			return colors.info
		default:
			return colors.text
	}
}

export function getDiffStatusKey(type: DiffFileStatus): FileStatus {
	switch (type) {
		case "new":
			return "added"
		case "deleted":
			return "deleted"
		case "rename-pure":
		case "rename-changed":
			return "renamed"
		default:
			return "modified"
	}
}
