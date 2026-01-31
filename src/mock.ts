export type MockMode =
	| null
	| "error-stale"
	| "startup-no-vcs"
	| "startup-git"
	| "update-success"
	| "update-failed"
	| "logo"
	| "wave"
	| "whats-new"

export let mockMode: MockMode = null

export function setMockMode(mode: MockMode): void {
	mockMode = mode
}
