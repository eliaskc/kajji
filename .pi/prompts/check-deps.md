---
description: Check dependency updates, with priority on OpenTUI and Effect
---

Check for useful dependency updates. Give OpenTUI and Effect the most attention. This is a research task: do not change dependencies unless asked.

## Dependencies to Check

| Package | Current | Release notes entry point | Source clone |
|---------|---------|---------------------------|--------------|
| `@opentui/core` | Check package.json | https://github.com/anomalyco/opentui/releases | `git clone https://github.com/anomalyco/opentui /tmp/opentui` |
| `@opentui/solid` | Check package.json | https://github.com/anomalyco/opentui/releases | `git clone https://github.com/anomalyco/opentui /tmp/opentui` |
| `@pierre/diffs` | Check package.json | https://github.com/pierrecomputer/pierre/releases | `git clone https://github.com/pierrecomputer/pierre /tmp/pierre` |
| `effect` | Check package.json and bun.lock | https://github.com/Effect-TS/effect/blob/main/packages/effect/CHANGELOG.md (Effect 4; verify the current upstream) | `git clone https://github.com/Effect-TS/effect /tmp/effect` |
| `solid-js` + `babel-preset-solid` | Check package.json and bun.lock | https://github.com/solidjs/solid/releases | `git clone https://github.com/solidjs/solid /tmp/solid` |
| `shiki` + `@shikijs/langs` + `@shikijs/themes` | Check package.json and bun.lock | https://github.com/shikijs/shiki/releases | `git clone https://github.com/shikijs/shiki /tmp/shiki` |
| `zod` | Check package.json and bun.lock | https://github.com/colinhacks/zod/releases | `git clone https://github.com/colinhacks/zod /tmp/zod` |
| `diff` | Check package.json and bun.lock | https://github.com/kpdecker/jsdiff/releases | `git clone https://github.com/kpdecker/jsdiff /tmp/jsdiff` |
| `bun` | Run `bun --version` | https://github.com/oven-sh/bun/releases | `git clone https://github.com/oven-sh/bun /tmp/bun` |

## Steps

1. Read `package.json` and `bun.lock` to get declared ranges and resolved versions. Use resolved versions as the comparison baseline for all npm dependencies.
2. Run `bun --version` to get current Bun version
3. Check release notes links as entry points for identifying notable changes. Use package manager metadata only to identify versions. Separate stable and prerelease versions. For Effect, compare within the installed prerelease line (for example `rc`); do not treat an older stable major as an upgrade. Verify the upstream repository for that release line before cloning.
4. Clone each dependency source repo into `/tmp` (or update the existing `/tmp` clone). Reuse one clone for packages in the same repository.
5. Inspect source, tags, changelogs, and release notes to compare current vs latest available. Check relevant kajji call sites to verify impact before making recommendations. Give OpenTUI and Effect detailed coverage; keep other dependencies brief unless they have a significant change.
6. Review releases between current and latest, but report only changes relevant to kajji. Group related changes instead of listing every release. Look for:
   - New features or APIs that could benefit kajji
   - Bug fixes that might affect us
   - Breaking changes to watch for
   - Performance improvements

## Output Format

Start with the decision, not a release-note list. Use this structure:

```markdown
## Dependency Update Report

### Summary
[One or two sentences: what to update first and what needs investigation.]

| Dependency group | Resolved → candidate | Action | Main reason |
|------------------|----------------------|--------|-------------|
| OpenTUI | ... | upgrade/wait/investigate | ... |
| Effect | ... | upgrade/wait/investigate | ... |
| ... | ... | ... | ... |

### OpenTUI
**Recommendation:** [action and reason]
- **Benefit:** [relevant change, version, source link, and affected kajji path]
- **Risk:** [breaking changes, compatibility constraints, or uncertainty]
- **Validation:** [specific tests or manual checks needed before an upgrade]

### Effect
**Recommendation:** [action and reason; identify the release line]
- **Benefit:** [relevant change, version, source link, and affected kajji path]
- **Risk:** [API changes, runtime behavior, or uncertainty]
- **Validation:** [specific tests needed before an upgrade]

### Other Dependencies
[Short bullets for significant changes. Keep unchanged or low-impact dependencies in the summary table only.]

### Suggested Next Step
[Smallest useful upgrade group and its validation plan. Do not apply updates.]
```

Include a row for every dependency group checked. Mark unavailable evidence or incomplete checks explicitly. Separate source-verified findings from expected benefits that still need testing. Do not claim performance gains without measurements. Link each substantive finding to release notes, a changelog, or source.

## What to Look For

### OpenTUI
- New components or hooks
- Keyboard/input handling improvements (we have custom keybind system)
- Scrolling/layout fixes (we use scrollbox heavily)
- Performance improvements (large diffs, long logs)
- Renderer improvements (colors, styling)

### Effect (primary focus, alongside OpenTUI)
- Changes within the installed Effect 4 prerelease line and migration requirements
- Services, layers, runtime lifecycle, and typed errors
- Fiber interruption, AbortSignal integration, timeouts, and resource cleanup
- Child-process execution, streaming output, and child reaping
- Impact on `src/process/`, commander services, and `ApplicationClient`

### Solid + babel-preset-solid
- Reactive updates, owner disposal, and cleanup fixes
- JSX compilation and compatibility with the OpenTUI Solid integration
- Runtime/compiler version compatibility

### Shiki + language/theme packages
- Highlighting correctness and language/theme changes
- Large-file performance, memory use, and loading behavior
- Compatibility with Pierre/Diffs; keep related Shiki packages aligned

### Zod
- Configuration parsing, validation errors, and compatibility
- JSON Schema generation changes and generated schema differences

### diff
- Diff calculation correctness and large-file performance
- API changes that affect kajji call sites, separate from Pierre/Diffs parsing

### Pierre/Diffs
- New diff parsing features
- Annotation/highlighting improvements
- Performance for large diffs
- Bug fixes in hunk parsing

### Bun
- TypeScript/bundling improvements
- Performance improvements
- New APIs (shell, file I/O)
- Bug fixes affecting TUI apps

## When to Recommend Upgrade

- **Upgrade**: Clear benefit, no breaking changes
- **Wait**: Minor changes, low impact
- **Investigate**: Breaking changes or significant API shifts
