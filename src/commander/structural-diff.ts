import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import type { FlattenedFile } from "../diff/parser"
import type { DifftFileResult } from "../diff/structural/difft-json"
import { difftOutputSchema } from "../diff/structural/difft-json"
import {
    flattenStructuralFile,
    structuralCandidate,
} from "../diff/structural/flatten"
import { AppProcess, type ProcessError } from "../process/app-process"
import type { JjDiffTarget } from "./jj"

export class StructuralDiffError extends Schema.TaggedErrorClass<StructuralDiffError>()(
    "StructuralDiffError",
    {
        reason: Schema.String,
    },
) {}

export interface StructuralDiffRequest {
    readonly target: JjDiffTarget
    readonly cwd: string
    /** Textual (flattened) files of the same revision; also the per-file
     * fallback when a file cannot be represented structurally. */
    readonly files: readonly FlattenedFile[]
}

export interface StructuralDiffService {
    readonly diff: (
        request: StructuralDiffRequest,
    ) => Effect.Effect<FlattenedFile[], StructuralDiffError | ProcessError>
}

export class StructuralDiff extends Context.Service<
    StructuralDiff,
    StructuralDiffService
>()("kajji/StructuralDiff") {}

const TOOL_NAME = "kajji-structural"

function makeDiffTargetArgs(target: JjDiffTarget): string[] {
    return "revision" in target
        ? ["-r", target.revision]
        : ["--from", target.from, "--to", target.to]
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

/**
 * Directory mode pairs files strictly by path, so a rename would degrade to
 * deleted+created. The textual parse already knows the mapping — move the
 * old side to the new path before Difftastic sees the trees.
 */
async function normalizeRenames(
    left: string,
    files: readonly FlattenedFile[],
): Promise<void> {
    for (const file of files) {
        if (!file.prevName || file.prevName === file.name) continue
        const from = join(left, file.prevName)
        const to = join(left, file.name)
        try {
            await mkdir(dirname(to), { recursive: true })
            await rename(from, to)
        } catch {
            // Old side may be absent (e.g. rename of an untracked path);
            // the file simply falls back to the textual engine.
        }
    }
}

async function buildFiles(
    files: readonly FlattenedFile[],
    results: readonly DifftFileResult[],
    left: string,
    right: string,
): Promise<FlattenedFile[]> {
    const byPath = new Map(results.map((result) => [result.path, result]))

    return Promise.all(
        files.map(async (file) => {
            const result = byPath.get(file.name)
            if (
                !structuralCandidate(file) ||
                !result ||
                result.status !== "changed"
            ) {
                // Includes formatting-only files (status "unchanged"): they
                // stay visible as textual diffs rather than being hidden.
                return file
            }
            try {
                const [oldContent, newContent] = await Promise.all([
                    Bun.file(join(left, file.name)).text(),
                    Bun.file(join(right, file.name)).text(),
                ])
                const flattened = flattenStructuralFile(
                    file,
                    oldContent,
                    newContent,
                    result,
                )
                return flattened.kind === "structural" ? flattened.file : file
            } catch {
                // Tree contents unavailable for this file; keep the
                // textual rendering.
                return file
            }
        }),
    )
}

/**
 * Structural diff pipeline: materialize both sides of a revision once via
 * jj's external-diff-tool machinery (the "tool" copies the temp trees into
 * a session directory that outlives the jj invocation), normalize renames,
 * run a single directory-mode Difftastic invocation, and map its output
 * onto the flattened rendering model with per-file textual fallback.
 */
export const StructuralDiffLive: Layer.Layer<
    StructuralDiff,
    never,
    AppProcess
> = Layer.effect(
    StructuralDiff,
    Effect.gen(function* () {
        const appProcess = yield* AppProcess

        const acquireSession = Effect.acquireRelease(
            Effect.tryPromise({
                try: () => mkdtemp(join(tmpdir(), "kajji-structural-")),
                catch: (cause) =>
                    new StructuralDiffError({
                        reason: `failed to create session dir: ${cause}`,
                    }),
            }),
            (session) =>
                Effect.promise(() =>
                    rm(session, { recursive: true, force: true }),
                ),
        )

        const diff = Effect.fn("StructuralDiff.diff")(
            (request: StructuralDiffRequest) =>
                Effect.scoped(
                    Effect.gen(function* () {
                        const session = yield* acquireSession

                        const script = join(session, "copy-trees.sh")
                        yield* Effect.tryPromise({
                            try: () =>
                                writeFile(
                                    script,
                                    `#!/bin/sh\ncp -R "$1" "${session}/left"\ncp -R "$2" "${session}/right"\n`,
                                    { mode: 0o755 },
                                ),
                            catch: (cause) =>
                                new StructuralDiffError({
                                    reason: `failed to write copy script: ${cause}`,
                                }),
                        })

                        // JSON string escaping is valid TOML basic-string
                        // escaping for the config values below.
                        const materialized = yield* appProcess.run({
                            executable: "jj",
                            args: [
                                "diff",
                                ...makeDiffTargetArgs(request.target),
                                "--ignore-working-copy",
                                "--config",
                                `merge-tools.${TOOL_NAME}.program=${JSON.stringify(script)}`,
                                "--config",
                                `merge-tools.${TOOL_NAME}.diff-args=["$left", "$right"]`,
                                "--tool",
                                TOOL_NAME,
                            ],
                            cwd: request.cwd,
                        })
                        if (materialized.exitCode !== 0) {
                            return yield* new StructuralDiffError({
                                reason: `jj materialization exited ${materialized.exitCode}: ${materialized.stderr.slice(0, 300)}`,
                            })
                        }

                        const left = join(session, "left")
                        const right = join(session, "right")
                        // An empty diff never invokes the tool, leaving no
                        // trees behind.
                        const treesExist = yield* Effect.promise(async () => {
                            const [l, r] = await Promise.all([
                                exists(left),
                                exists(right),
                            ])
                            return l && r
                        })
                        if (!treesExist) {
                            return yield* new StructuralDiffError({
                                reason: "empty diff: no trees materialized",
                            })
                        }

                        yield* Effect.promise(() =>
                            normalizeRenames(left, request.files),
                        )

                        const difft = yield* appProcess.run({
                            executable: "difft",
                            args: ["--display", "json", left, right],
                            cwd: request.cwd,
                            env: { DFT_UNSTABLE: "yes" },
                        })
                        if (difft.exitCode !== 0) {
                            return yield* new StructuralDiffError({
                                reason: `difft exited ${difft.exitCode}: ${difft.stderr.slice(0, 300)}`,
                            })
                        }

                        const json = yield* Effect.try({
                            try: () => JSON.parse(difft.stdout) as unknown,
                            catch: () =>
                                new StructuralDiffError({
                                    reason: "difft emitted invalid JSON",
                                }),
                        })
                        // The JSON schema is explicitly unstable upstream
                        // (and old difft versions lack aligned_lines);
                        // any mismatch means textual fallback.
                        const parsed = difftOutputSchema.safeParse(json)
                        if (!parsed.success) {
                            return yield* new StructuralDiffError({
                                reason: `unexpected difft JSON shape: ${parsed.error.issues[0]?.message ?? "unknown"}`,
                            })
                        }

                        return yield* Effect.promise(() =>
                            buildFiles(request.files, parsed.data, left, right),
                        )
                    }),
                ),
        )

        return StructuralDiff.of({ diff })
    }),
)
