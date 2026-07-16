export const HookOperation = {
    JjNew: "jj.new",
} as const

export type HookOperationId = (typeof HookOperation)[keyof typeof HookOperation]
