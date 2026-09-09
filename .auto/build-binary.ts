import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import { mkdir, chmod } from "node:fs/promises"
import { resolve } from "node:path"
const pkg = await Bun.file("package.json").json()
const outfile = resolve(".kajji-benchmarks/startup-auto/bundled/kajji")
await mkdir(resolve(outfile, ".."), { recursive: true })
const result = await Bun.build({
    entrypoints: ["./src/index.tsx", "./src/diff/syntax-worker.ts"],
    minify: true,
    sourcemap: "none",
    plugins: [solidPlugin],
    conditions: ["browser"],
    define: { "process.env.KAJJI_VERSION": JSON.stringify(pkg.version) },
    compile: { target: "bun-darwin-arm64", outfile },
})
if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
}
await chmod(outfile, 0o755)
console.log(`Release-settings binary: ${outfile}`)
