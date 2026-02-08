import { afterEach, describe, expect, it } from "bun:test"
import {
	getPreferredEditor,
	shouldSuspendForEditor,
} from "../../../src/utils/editor"

const originalVisual = process.env.VISUAL
const originalEditor = process.env.EDITOR
const originalSuspend = process.env.KAJJI_EDITOR_SUSPEND

afterEach(() => {
	if (originalVisual === undefined) process.env.VISUAL = undefined
	else process.env.VISUAL = originalVisual

	if (originalEditor === undefined) process.env.EDITOR = undefined
	else process.env.EDITOR = originalEditor

	if (originalSuspend === undefined)
		process.env.KAJJI_EDITOR_SUSPEND = undefined
	else process.env.KAJJI_EDITOR_SUSPEND = originalSuspend
})

describe("getPreferredEditor", () => {
	it("uses VISUAL when both VISUAL and EDITOR are set", () => {
		process.env.VISUAL = "code --wait"
		process.env.EDITOR = "nvim"

		expect(getPreferredEditor()).toBe("code --wait")
	})

	it("uses EDITOR when VISUAL is not set", () => {
		process.env.VISUAL = undefined
		process.env.EDITOR = "nvim"

		expect(getPreferredEditor()).toBe("nvim")
	})

	it("falls back to vi when neither VISUAL nor EDITOR is set", () => {
		process.env.VISUAL = undefined
		process.env.EDITOR = undefined

		expect(getPreferredEditor()).toBe("vi")
	})
})

describe("shouldSuspendForEditor", () => {
	it("does not suspend for GUI editors", () => {
		expect(shouldSuspendForEditor("code --wait")).toBe(false)
	})

	it("suspends for terminal editors", () => {
		expect(shouldSuspendForEditor("nvim")).toBe(true)
	})
})
