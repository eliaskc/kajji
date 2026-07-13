import type { ProcessResult } from "../process/app-process"

/**
 * Parsed jj error with structured information
 */
export interface ParsedJjError {
    /** The main error type/title (e.g., "The working copy is stale") */
    title: string
    /** Full error message text */
    message: string
    /** Extracted hint text (from "Hint:" lines) */
    hints: string[]
    /** Extracted URLs from the error message */
    urls: string[]
    /** Known error type for automatic fix suggestions */
    errorType: KnownErrorType | null
    /** Suggested fix command if applicable */
    fixCommand: string | null
}

export type KnownErrorType = "stale-working-copy" | "immutable-commit"

const STALE_WORKING_COPY_PATTERN =
    /working copy is stale|stale working copy|working-copy is behind|could not read working copy's operation/i

export function isStaleWorkingCopyFailure(
    result: Pick<ProcessResult, "exitCode" | "stdout" | "stderr">,
): boolean {
    return (
        result.exitCode !== 0 &&
        STALE_WORKING_COPY_PATTERN.test(result.stdout + result.stderr)
    )
}

/**
 * Known error patterns with their fix commands
 */
const KNOWN_ERRORS: Array<{
    pattern: RegExp
    type: KnownErrorType
    fixCommand: string
}> = [
    {
        pattern: STALE_WORKING_COPY_PATTERN,
        type: "stale-working-copy",
        fixCommand: "jj workspace update-stale",
    },
]

/**
 * Parse a jj error message to extract structured information
 */
export function parseJjError(errorMessage: string): ParsedJjError {
    const lines = errorMessage.split("\n")

    // Extract main error (first line, remove common prefixes)
    const firstLine = lines[0] ?? errorMessage
    let title = firstLine
        .replace(/^jj\s+\w+\s+failed:\s*/i, "") // Remove "jj log failed:" etc
        .replace(/^Error:\s*/i, "") // Remove "Error:"
        .trim()

    // Extract parenthetical details from title
    const parenMatch = title.match(/^(.+?)\s*\((.+)\)$/)
    if (parenMatch?.[1]) {
        title = parenMatch[1].trim()
    }

    // Extract hints (lines starting with "Hint:")
    const hints: string[] = []
    for (const line of lines) {
        const hintMatch = line.match(/^Hint:\s*(.+)$/i)
        if (hintMatch?.[1]) {
            hints.push(hintMatch[1].trim())
        }
    }

    // Extract URLs
    const urlRegex = /https?:\/\/[^\s)]+/g
    const urls = errorMessage.match(urlRegex) ?? []

    // Identify known error type
    let errorType: KnownErrorType | null = null
    let fixCommand: string | null = null

    for (const known of KNOWN_ERRORS) {
        if (known.pattern.test(errorMessage)) {
            errorType = known.type
            fixCommand = known.fixCommand
            break
        }
    }

    return {
        title,
        message: errorMessage,
        hints,
        urls,
        errorType,
        fixCommand,
    }
}

/**
 * Check if an error is a critical startup error that should show the error screen
 */
export function isCriticalStartupError(errorMessage: string | null): boolean {
    if (!errorMessage) return false

    // Check if this matches any known error type
    for (const known of KNOWN_ERRORS) {
        if (known.pattern.test(errorMessage)) {
            return true
        }
    }

    // Add more critical error patterns as needed
    return false
}
