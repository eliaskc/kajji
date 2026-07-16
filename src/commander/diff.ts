import { toFilesetArgs } from "../utils/jj-fileset"
import { profile } from "../utils/profiler"
import { execute } from "./executor"

export interface FetchDiffOptions {
    cwd?: string
    columns?: number
    paths?: string[]
}

function buildDiffEnv(options: FetchDiffOptions): Record<string, string> {
    const env: Record<string, string> = {}
    if (options.columns) {
        env.COLUMNS = String(options.columns)
    }
    return env
}

export async function fetchDiff(
    changeId: string,
    options: FetchDiffOptions = {},
): Promise<string> {
    const endTotal = profile(`fetchDiff(${changeId.slice(0, 8)})`)
    const env = buildDiffEnv(options)
    const args = ["diff", "-r", changeId, "--color", "always"]

    if (options.paths && options.paths.length > 0) {
        args.push(...toFilesetArgs(options.paths))
    }

    const result = await execute(args, { cwd: options.cwd, env })

    if (!result.success) {
        throw new Error(`jj diff failed: ${result.stderr}`)
    }

    endTotal()
    return result.stdout
}

export async function fetchDiffRange(
    from: string,
    to: string,
    options: FetchDiffOptions = {},
): Promise<string> {
    const endTotal = profile(`fetchDiffRange(${from}..${to})`)
    const env = buildDiffEnv(options)
    const args = ["diff", "--from", from, "--to", to, "--color", "always"]

    if (options.paths && options.paths.length > 0) {
        args.push(...toFilesetArgs(options.paths))
    }

    const result = await execute(args, { cwd: options.cwd, env })

    if (!result.success) {
        throw new Error(`jj diff failed: ${result.stderr}`)
    }

    endTotal()
    return result.stdout
}
