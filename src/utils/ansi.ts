// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g

export const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, "")

export const getVisibleWidth = (value: string) => stripAnsi(value).length
