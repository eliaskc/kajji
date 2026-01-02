import { describe, expect, it } from "bun:test"
import {
	fromParsedKey,
	keybindToString,
	match,
	parse,
} from "../../../src/keybind/parser"

describe("parse", () => {
	it("parses simple key", () => {
		const result = parse("j")
		expect(result).toEqual([
			{ name: "j", ctrl: false, meta: false, shift: false },
		])
	})

	it("parses ctrl modifier", () => {
		const result = parse("ctrl+d")
		expect(result).toEqual([
			{ name: "d", ctrl: true, meta: false, shift: false },
		])
	})

	it("parses alt/meta modifier", () => {
		const result = parse("alt+x")
		expect(result).toEqual([
			{ name: "x", ctrl: false, meta: true, shift: false },
		])
	})

	it("parses shift modifier", () => {
		const result = parse("shift+g")
		expect(result).toEqual([
			{ name: "g", ctrl: false, meta: false, shift: true },
		])
	})

	it("parses multiple modifiers", () => {
		const result = parse("ctrl+shift+s")
		expect(result).toEqual([
			{ name: "s", ctrl: true, meta: false, shift: true },
		])
	})

	it("parses comma-separated alternatives", () => {
		const result = parse("j,down")
		expect(result).toEqual([
			{ name: "j", ctrl: false, meta: false, shift: false },
			{ name: "down", ctrl: false, meta: false, shift: false },
		])
	})

	it("parses esc as escape", () => {
		const result = parse("esc")
		expect(result).toEqual([
			{ name: "escape", ctrl: false, meta: false, shift: false },
		])
	})

	it("returns empty array for none", () => {
		expect(parse("none")).toEqual([])
	})
})

describe("match", () => {
	it("matches identical keybinds", () => {
		const a = { name: "j", ctrl: false, meta: false, shift: false }
		const b = { name: "j", ctrl: false, meta: false, shift: false }
		expect(match(a, b)).toBe(true)
	})

	it("does not match different keys", () => {
		const a = { name: "j", ctrl: false, meta: false, shift: false }
		const b = { name: "k", ctrl: false, meta: false, shift: false }
		expect(match(a, b)).toBe(false)
	})

	it("does not match different modifiers", () => {
		const a = { name: "d", ctrl: true, meta: false, shift: false }
		const b = { name: "d", ctrl: false, meta: false, shift: false }
		expect(match(a, b)).toBe(false)
	})
})

describe("keybindToString", () => {
	it("formats simple key", () => {
		expect(
			keybindToString({ name: "j", ctrl: false, meta: false, shift: false }),
		).toBe("j")
	})

	it("formats with ctrl", () => {
		expect(
			keybindToString({ name: "d", ctrl: true, meta: false, shift: false }),
		).toBe("ctrl+d")
	})

	it("formats with multiple modifiers", () => {
		expect(
			keybindToString({ name: "s", ctrl: true, meta: false, shift: true }),
		).toBe("ctrl+S")
	})

	it("formats escape as esc", () => {
		expect(
			keybindToString({
				name: "escape",
				ctrl: false,
				meta: false,
				shift: false,
			}),
		).toBe("esc")
	})
})

describe("fromParsedKey", () => {
	it("converts parsed key event to keybind info", () => {
		const evt = { name: "j", ctrl: false, meta: false, shift: false }
		expect(fromParsedKey(evt)).toEqual({
			name: "j",
			ctrl: false,
			meta: false,
			shift: false,
		})
	})

	it("handles undefined values", () => {
		const evt = { name: "x" }
		expect(fromParsedKey(evt)).toEqual({
			name: "x",
			ctrl: false,
			meta: false,
			shift: false,
		})
	})

	it("normalizes return to enter", () => {
		const evt = { name: "return", ctrl: false, meta: false, shift: false }
		expect(fromParsedKey(evt)).toEqual({
			name: "enter",
			ctrl: false,
			meta: false,
			shift: false,
		})
	})
})
