import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import type { AppConfig, EffectiveConfig, RepoConfig } from "./schema"

function expandHome(path: string): string {
    if (path === "~") return homedir()
    if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
    return path
}

function resolveConfigPath(path: string): string {
    const expanded = expandHome(path)
    return isAbsolute(expanded) ? resolve(expanded) : resolve(expanded)
}

function isPathWithin(path: string, parent: string): boolean {
    return path === parent || path.startsWith(`${parent}/`)
}

function findRepoConfig(
    repos: Record<string, RepoConfig>,
    repoPath: string,
): RepoConfig | undefined {
    const resolvedRepoPath = resolve(repoPath)
    let bestMatch: { path: string; config: RepoConfig } | undefined

    for (const [configuredPath, config] of Object.entries(repos)) {
        const resolvedConfiguredPath = resolveConfigPath(configuredPath)
        if (!isPathWithin(resolvedRepoPath, resolvedConfiguredPath)) continue
        if (
            !bestMatch ||
            resolvedConfiguredPath.length > bestMatch.path.length
        ) {
            bestMatch = { path: resolvedConfiguredPath, config }
        }
    }

    return bestMatch?.config
}

export function applyRepoConfig(
    config: AppConfig,
    repoPath: string,
): EffectiveConfig {
    const repoConfig = findRepoConfig(config.repos, repoPath)

    return {
        ...config,
        gitHooksPath:
            repoConfig?.gitHooksPath !== undefined
                ? repoConfig.gitHooksPath
                : config.gitHooksPath,
        hooks: repoConfig?.hooks ?? {},
    }
}
