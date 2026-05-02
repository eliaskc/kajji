import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"

export type UpdateStatus =
	| "idle"
	| "checking"
	| "updating"
	| "success"
	| "failure"

export interface UpdateState {
	status: UpdateStatus
	version?: string
	command?: string
	completedAt?: Date
}

export const { use: useUpdate, provider: UpdateProvider } = createSimpleContext(
	{
		name: "Update",
		init: () => {
			const [state, setState] = createSignal<UpdateState>({ status: "idle" })
			let resetTimer: ReturnType<typeof setTimeout> | undefined

			const clearResetTimer = () => {
				if (!resetTimer) return
				clearTimeout(resetTimer)
				resetTimer = undefined
			}

			return {
				state,
				setChecking: () => {
					clearResetTimer()
					setState({ status: "checking" })
				},
				setUpdating: (version: string, command: string) => {
					clearResetTimer()
					setState({ status: "updating", version, command })
				},
				setSuccess: (version: string) => {
					clearResetTimer()
					setState({ status: "success", version, completedAt: new Date() })
					resetTimer = setTimeout(() => setState({ status: "idle" }), 2000)
				},
				setFailure: (version: string) => {
					clearResetTimer()
					setState({ status: "failure", version, completedAt: new Date() })
				},
				setIdle: () => {
					clearResetTimer()
					setState({ status: "idle" })
				},
			}
		},
	},
)
