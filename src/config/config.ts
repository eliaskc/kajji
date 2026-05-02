import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { writeFileAtomic } from "../utils/atomic-write"
import { migrateStateIfNeeded } from "../utils/state"
import { type AppConfig, ConfigSchema, SCHEMA_URL } from "./schema"

const CONFIG_DIR = join(homedir(), ".config", "kajji")

export function getConfigPath(): string {
	return join(CONFIG_DIR, "config.json")
}

let cachedConfig: AppConfig | null = null
type ConfigChangeListener = (config: AppConfig) => void
const configChangeListeners = new Set<ConfigChangeListener>()

function notifyConfigChange(config: AppConfig): void {
	for (const listener of configChangeListeners) {
		listener(config)
	}
}

function hasLegacyTheme(raw: unknown): boolean {
	if (!raw || typeof raw !== "object") return false
	const ui = (raw as { ui?: unknown }).ui
	if (!ui || typeof ui !== "object") return false
	const theme = (ui as { theme?: unknown }).theme
	return theme === "lazygit" || theme === "opencode"
}

function migrateConfigFile(config: AppConfig): void {
	try {
		writeFileAtomic(getConfigPath(), JSON.stringify(config, null, "\t"))
	} catch {
		// Best effort: keep using the migrated in-memory config if writing fails.
	}
}

export function onConfigChange(listener: ConfigChangeListener): () => void {
	configChangeListeners.add(listener)
	return () => {
		configChangeListeners.delete(listener)
	}
}

export function readConfig(): AppConfig {
	if (cachedConfig) return cachedConfig
	migrateStateIfNeeded()

	const configPath = getConfigPath()
	if (!existsSync(configPath)) {
		cachedConfig = ConfigSchema.parse({})
		return cachedConfig
	}

	try {
		const content = readFileSync(configPath, "utf-8")
		const raw = parseJsonc(content)
		const result = ConfigSchema.safeParse(raw ?? {})
		if (result.success) {
			cachedConfig = result.data
			if (hasLegacyTheme(raw)) {
				migrateConfigFile(cachedConfig)
			}
		} else {
			// Log validation issues but don't crash — use defaults
			for (const issue of result.error.issues) {
				const path = issue.path.join(".")
				console.error(`[config] Invalid field "${path}": ${issue.message}`)
			}
			cachedConfig = ConfigSchema.parse({})
		}
		return cachedConfig
	} catch {
		cachedConfig = ConfigSchema.parse({})
		return cachedConfig
	}
}

export function writeConfig(updates: Partial<AppConfig>): void {
	const current = readConfig()
	const merged = { ...current, ...updates }
	// Preserve $schema if it was set
	if (current.$schema) {
		merged.$schema = current.$schema
	}
	const configPath = getConfigPath()
	writeFileAtomic(configPath, JSON.stringify(merged, null, "\t"))
	cachedConfig = merged as AppConfig
	notifyConfigChange(cachedConfig)
}

export function reloadConfig(): AppConfig {
	cachedConfig = null
	const config = readConfig()
	notifyConfigChange(config)
	return config
}

const DEFAULT_CONFIG_CONTENT = `{
\t// JSON Schema for editor autocomplete (ctrl+space)
\t"$schema": "${SCHEMA_URL}"
}
`

export function createDefaultConfig(): string {
	const configPath = getConfigPath()
	if (!existsSync(configPath)) {
		writeFileAtomic(configPath, DEFAULT_CONFIG_CONTENT)
	}
	return configPath
}
