const truthy = new Set(["1", "true", "yes", "on"])

function envFlag(name: string): boolean {
    const value = process.env[name]
    return typeof value === "string" && truthy.has(value.toLowerCase())
}

export const featureFlags = {
    githubStacking: () => envFlag("KAJJI_ENABLE_STACKING"),
}
