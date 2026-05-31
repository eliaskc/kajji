---
description: Check for useful updates in key TUI dependencies
---

Check for useful updates in key TUI dependencies.

## Dependencies to Check

| Package | Current | Release notes entry point | Source clone |
|---------|---------|---------------------------|--------------|
| `@opentui/core` | Check package.json | https://github.com/anomalyco/opentui/releases | `git clone https://github.com/anomalyco/opentui /tmp/opentui` |
| `@opentui/solid` | Check package.json | https://github.com/anomalyco/opentui/releases | `git clone https://github.com/anomalyco/opentui /tmp/opentui` |
| `@pierre/diffs` | Check package.json | https://github.com/pierrecomputer/pierre/releases | `git clone https://github.com/pierrecomputer/pierre /tmp/pierre` |
| `bun` | Run `bun --version` | https://github.com/oven-sh/bun/releases | `git clone https://github.com/oven-sh/bun /tmp/bun` |

## Steps

1. Read `package.json` to get current versions of npm dependencies
2. Run `bun --version` to get current Bun version
3. Check release notes links as entry points for identifying notable changes
4. Clone each dependency source repo into `/tmp` (or update the existing `/tmp` clone)
5. Inspect source, tags, changelogs, and release notes to compare current vs latest available. Use source analysis to verify behavior before making recommendations.
6. For each release between current and latest, summarize:
   - New features or APIs that could benefit kajji
   - Bug fixes that might affect us
   - Breaking changes to watch for
   - Performance improvements

## Output Format

```markdown
## Dependency Update Report

### @opentui/core + @opentui/solid
**Current:** x.y.z → **Latest:** a.b.c

#### Relevant Changes
- **0.1.XX**: feature description (how it helps kajji)
- **0.1.XX**: fix description

#### Recommended Action
[upgrade/wait/investigate]

### @pierre/diffs
**Current:** x.y.z → **Latest:** a.b.c

#### Relevant Changes
- ...

#### Recommended Action
[upgrade/wait/investigate]

### bun
**Current:** x.y.z → **Latest:** a.b.c

#### Relevant Changes
- ...

#### Recommended Action
[upgrade/wait/investigate]
```

## What to Look For

### OpenTUI
- New components or hooks
- Keyboard/input handling improvements (we have custom keybind system)
- Scrolling/layout fixes (we use scrollbox heavily)
- Performance improvements (large diffs, long logs)
- Renderer improvements (colors, styling)

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
