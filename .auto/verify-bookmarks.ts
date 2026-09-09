import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { BOOKMARK_TEMPLATE, BOOKMARK_REFERENCE_TEMPLATE, parseBookmarkOutput, groupBookmarkTargetReads, bookmarkTargetTemplate, applyBookmarkTargets } from "../src/commander/bookmarks"
import { isDeepStrictEqual } from "node:util"
for (const fixture of ["stress", "goodmorning"]) {
 const root = resolve(`.kajji-benchmarks/fixtures/${fixture}`)
 const op = JSON.parse(readFileSync(`${root}/fixture.json`, "utf8")).operation
 const read = (template: string, names: string[] = [], custom = false) => {
  const result = Bun.spawnSync(["jj", "--color", "always", "--ignore-working-copy", "--at-operation", op,
  ...(custom ? ["--config", 'colors."bookmark_list change_id"="red"', "--config", 'colors."log commit change_id"="blue"', "--config", 'template-aliases."format_short_change_id(id)"=\'label("change_id", "custom:" ++ id.short(6))\''] : []),
  "bookmark", "list", "--sort", "committer-date-", "--all-remotes", "--template", template, ...names.map(n => `exact:${n}`)], {cwd: `${root}/repo`})
  if (result.exitCode) throw new Error(result.stderr.toString())
  return parseBookmarkOutput(result.stdout.toString())
 }
 for (const custom of [false, true]) {
  const expected = read(BOOKMARK_TEMPLATE, [], custom)
  const refs = read(BOOKMARK_REFERENCE_TEMPLATE, [], custom)
  const groups = groupBookmarkTargetReads(refs)
  const targets = groups.flatMap(group => read(bookmarkTargetTemplate(group.remote), group.names, custom))
  const actual = applyBookmarkTargets(refs, targets)
  if (!isDeepStrictEqual(actual, expected)) {
   const at = expected.findIndex((v,i) => !isDeepStrictEqual(v,actual?.[i]))
   throw new Error(`${fixture}: mismatch at ${at}; keys ${Object.keys(expected[at] ?? {}).filter(k => expected[at][k] !== actual?.[at]?.[k])}`)
  }
  console.log(`${fixture}: ${expected.length} references match exactly; ${targets.length} unique targets, ${groups.length} reads; custom=${custom}`)
 }
}
