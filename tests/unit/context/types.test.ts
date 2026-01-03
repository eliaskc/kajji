import { describe, expect, test } from "bun:test"
import { panelFromContext } from "../../../src/context/types"

describe("panelFromContext", () => {
	test("returns null for global context", () => {
		expect(panelFromContext("global")).toBeNull()
	})

	test("returns null for help context", () => {
		expect(panelFromContext("help")).toBeNull()
	})

	test("returns log for log panel contexts", () => {
		expect(panelFromContext("log")).toBe("log")
		expect(panelFromContext("log.revisions")).toBe("log")
		expect(panelFromContext("log.files")).toBe("log")
		expect(panelFromContext("log.oplog")).toBe("log")
	})

	test("returns refs for refs panel contexts", () => {
		expect(panelFromContext("refs")).toBe("refs")
		expect(panelFromContext("refs.bookmarks")).toBe("refs")
		expect(panelFromContext("refs.revisions")).toBe("refs")
		expect(panelFromContext("refs.files")).toBe("refs")
	})

	test("returns detail for detail panel context", () => {
		expect(panelFromContext("detail")).toBe("detail")
	})
})
