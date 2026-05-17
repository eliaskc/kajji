import { type ParentProps, createContext, useContext } from "solid-js"

export function createSimpleContext<T>(input: {
    name: string
    init: () => T
}) {
    const ctx = createContext<T>()

    return {
        provider: (props: ParentProps) => {
            const value = input.init()
            return <ctx.Provider value={value}>{props.children}</ctx.Provider>
        },
        use: () => {
            const value = useContext(ctx)
            if (!value) {
                throw new Error(
                    `use${input.name} must be used within ${input.name}Provider`,
                )
            }
            return value
        },
    }
}
