import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    getDiagnosticsDirectory,
    getLogPath,
    writeDebugSnapshot,
} from "../../../src/utils/diagnostics"

const originalStateHome = process.env.XDG_STATE_HOME
const testStateHome = join(tmpdir(), `kajji-diagnostics-${process.pid}`)

afterEach(() => {
    if (originalStateHome === undefined) {
        Reflect.deleteProperty(process.env, "XDG_STATE_HOME")
    } else {
        process.env.XDG_STATE_HOME = originalStateHome
    }
    rmSync(testStateHome, { recursive: true, force: true })
})

describe("diagnostics", () => {
    test("uses XDG_STATE_HOME for logs", () => {
        process.env.XDG_STATE_HOME = testStateHome

        expect(getDiagnosticsDirectory()).toBe(
            join(testStateHome, "kajji", "log"),
        )
        expect(getLogPath()).toBe(
            join(testStateHome, "kajji", "log", "kajji.log"),
        )
    })

    test("writes a JSON debug snapshot", () => {
        process.env.XDG_STATE_HOME = testStateHome

        const path = writeDebugSnapshot()
        const snapshot = JSON.parse(readFileSync(path, "utf8"))

        expect(existsSync(path)).toBe(true)
        expect(snapshot).toMatchObject({
            kajjiVersion: expect.any(String),
            bunVersion: Bun.version,
            memoryUsage: expect.any(Object),
        })
    })
})
