import {
    beforeEach,
    describe,
    expect,
    mock,
    setSystemTime,
    test,
} from "bun:test"
import {
    createDoubleClickDetector,
    createDoubleClickHandler,
} from "../../../src/utils/double-click"

describe("createDoubleClickDetector", () => {
    beforeEach(() => {
        setSystemTime(new Date("2025-01-01T00:00:00.000Z"))
    })

    test("calls onDoubleClick when clicked twice within timeout", () => {
        const onDoubleClick = mock(() => {})
        const handler = createDoubleClickDetector(onDoubleClick, 300)

        handler()
        setSystemTime(new Date("2025-01-01T00:00:00.200Z"))
        handler()

        expect(onDoubleClick).toHaveBeenCalledTimes(1)
    })

    test("does not call onDoubleClick on single click", () => {
        const onDoubleClick = mock(() => {})
        const handler = createDoubleClickDetector(onDoubleClick, 300)

        handler()

        expect(onDoubleClick).not.toHaveBeenCalled()
    })

    test("does not call onDoubleClick when clicks are too far apart", () => {
        const onDoubleClick = mock(() => {})
        const handler = createDoubleClickDetector(onDoubleClick, 300)

        handler()
        setSystemTime(new Date("2025-01-01T00:00:00.400Z"))
        handler()

        expect(onDoubleClick).not.toHaveBeenCalled()
    })

    test("resets after double-click", () => {
        const onDoubleClick = mock(() => {})
        const handler = createDoubleClickDetector(onDoubleClick, 300)

        handler()
        setSystemTime(new Date("2025-01-01T00:00:00.100Z"))
        handler()

        expect(onDoubleClick).toHaveBeenCalledTimes(1)

        setSystemTime(new Date("2025-01-01T00:00:00.200Z"))
        handler()

        expect(onDoubleClick).toHaveBeenCalledTimes(1)
    })

    test("uses custom timeout", () => {
        const onDoubleClick = mock(() => {})
        const handler = createDoubleClickDetector(onDoubleClick, 100)

        handler()
        setSystemTime(new Date("2025-01-01T00:00:00.150Z"))
        handler()

        expect(onDoubleClick).not.toHaveBeenCalled()
    })
})

describe("createDoubleClickHandler", () => {
    beforeEach(() => {
        setSystemTime(new Date("2025-01-01T00:00:00.000Z"))
    })

    test("calls onDoubleClick when clicked twice within timeout", () => {
        const onSingleClick = mock(() => {})
        const onDoubleClick = mock(() => {})
        const handler = createDoubleClickHandler(
            onSingleClick,
            onDoubleClick,
            300,
        )

        handler()
        setSystemTime(new Date("2025-01-01T00:00:00.200Z"))
        handler()

        expect(onDoubleClick).toHaveBeenCalledTimes(1)
        expect(onSingleClick).not.toHaveBeenCalled()
    })

    test("does not call onDoubleClick when clicks are too far apart", () => {
        const onSingleClick = mock(() => {})
        const onDoubleClick = mock(() => {})
        const handler = createDoubleClickHandler(
            onSingleClick,
            onDoubleClick,
            300,
        )

        handler()
        setSystemTime(new Date("2025-01-01T00:00:00.400Z"))
        handler()

        expect(onDoubleClick).not.toHaveBeenCalled()
    })

    test("works without callbacks", () => {
        const handler = createDoubleClickHandler(undefined, undefined, 300)

        expect(() => {
            handler()
            setSystemTime(new Date("2025-01-01T00:00:00.200Z"))
            handler()
        }).not.toThrow()
    })
})
