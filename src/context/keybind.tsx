import { createMemo } from "solid-js"
import {
    DEFAULT_KEYBINDS,
    type KeybindConfigKey,
    type KeybindInfo,
    fromParsedKey,
    keybindToString,
    match,
    parse,
} from "../keybind"
import { createSimpleContext } from "./helper"

export const { use: useKeybind, provider: KeybindProvider } =
    createSimpleContext({
        name: "Keybind",
        init: () => {
            const keybinds = createMemo(() => {
                const parsed: Record<string, KeybindInfo[]> = {}
                for (const [key, value] of Object.entries(DEFAULT_KEYBINDS)) {
                    parsed[key] = parse(value)
                }
                return parsed
            })

            return {
                match: (
                    configKey: KeybindConfigKey,
                    evt: {
                        name?: string
                        ctrl?: boolean
                        meta?: boolean
                        shift?: boolean
                    },
                ): boolean => {
                    const bindings = keybinds()[configKey]
                    if (!bindings) return false
                    const parsed = fromParsedKey(evt)
                    return bindings.some((binding) => match(binding, parsed))
                },

                print: (configKey: KeybindConfigKey): string => {
                    const bindings = keybinds()[configKey]
                    const first = bindings?.[0]
                    if (!first) return ""
                    return keybindToString(first)
                },

                all: () => DEFAULT_KEYBINDS,
            }
        },
    })
