---
description: Check for useful updates in key TUI dependencies
---

Check for useful updates in key TUI dependencies.

## Dependencies to Check

| Package | Current | Releases URL |
|---------|---------|--------------|
| `@opentui/core` | Check package.json | https://github.com/sst/opentui/releases |
| `@opentui/solid` | Check package.json | https://github.com/sst/opentui/releases |
| `@pierre/diffs` | Check package.json | https://github.com/pierrecomputer/pierre/releases |
| `bun` | Run `bun --version` | https://github.com/oven-sh/bun/releases |

## Steps

1. Read `package.json` to get current versions of npm dependencies
2. Run `bun --version` to get current Bun version
3. Fetch the releases page for each dependency
4. Compare current version to latest available
5. For each release between current and latest, summarize:
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
