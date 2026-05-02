import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import { ConfigSchema } from "../src/config/schema"

type JsonSchema = Record<string, unknown> & {
	properties?: Record<string, JsonSchema>
	required?: string[]
	additionalProperties?: boolean
}

// Fields with defaults should not be required in a user-facing config schema,
// and unknown fields should be tolerated (not additionalProperties: false).
function relaxSchema(schema: JsonSchema): JsonSchema {
	const { required: _, additionalProperties: __, ...rest } = schema
	if (rest.properties) {
		const relaxed: Record<string, JsonSchema> = {}
		for (const [key, value] of Object.entries(rest.properties)) {
			relaxed[key] =
				typeof value === "object" && value !== null
					? relaxSchema(value as JsonSchema)
					: value
		}
		rest.properties = relaxed
	}
	return rest
}

const raw = z.toJSONSchema(ConfigSchema, { target: "draft-2020-12" })
const schema = relaxSchema(raw as JsonSchema)
schema.allowComments = true
schema.allowTrailingCommas = true
const output = JSON.stringify(schema, null, "\t")
const outPath = resolve(import.meta.dir, "../schema.json")
const siteOutPath = resolve(import.meta.dir, "../site/public/schema.json")
writeFileSync(outPath, `${output}\n`)
writeFileSync(siteOutPath, `${output}\n`)
console.log(`Generated ${outPath}`)
console.log(`Generated ${siteOutPath}`)
