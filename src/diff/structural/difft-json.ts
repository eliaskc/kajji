import { z } from "zod"

/**
 * Zod schema for Difftastic's `--display json` output (DFT_UNSTABLE=yes).
 * The schema is explicitly unstable upstream, so everything is validated
 * with safeParse and any mismatch falls back to the textual engine.
 *
 * Directory-mode output is a single JSON array with one entry per compared
 * file. `start`/`end` in changes are byte offsets into the line content.
 */

const difftChangeSchema = z.object({
    start: z.number(),
    end: z.number(),
    content: z.string(),
})

const difftSideSchema = z.object({
    line_number: z.number(),
    changes: z.array(difftChangeSchema),
})

const difftLineSchema = z.object({
    lhs: difftSideSchema.optional(),
    rhs: difftSideSchema.optional(),
})

const difftFileSchema = z.object({
    path: z.string(),
    language: z.string(),
    status: z.enum(["unchanged", "changed", "created", "deleted"]),
    aligned_lines: z.array(z.tuple([z.number().nullable(), z.number().nullable()])).optional(),
    chunks: z.array(z.array(difftLineSchema)).optional(),
})

export const difftOutputSchema = z.array(difftFileSchema)

export type DifftChange = z.infer<typeof difftChangeSchema>
export type DifftSide = z.infer<typeof difftSideSchema>
export type DifftLine = z.infer<typeof difftLineSchema>
export type DifftFileResult = z.infer<typeof difftFileSchema>

/**
 * The per-file subset consumed by the flattener. `path` is omitted so unit
 * tests and single-file invocations can construct results directly.
 */
export type StructuralFileResult = Omit<DifftFileResult, "path">
