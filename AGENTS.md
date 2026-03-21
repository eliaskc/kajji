# kajji Agent Guidelines

Follow the Boy Scout rule:
- For minor things, just improve them
- For larger improvements, create a GitHub issue or lift to the user
- If you see a lack of testing in an area, offer to add

## Task management


- Check existing issues before starting work
- When listing issues, include project status so Backlog/Ready/In Progress is visible. Recommended: `gh issue list --limit 200 --json number,title,projectItems --jq '.[] | "\(.number)\t\(.projectItems[0].status.name // "No status")\t\(.title)"'`
- Create issues for new bugs, features, improvements
- Use labels: `bug`, `feature`, `needs-exploration`, `ui-polish`, `tech-debt`, `docs`
- Reference issues in commit messages
- Close issues when work is done: prefer magic words in commits/PRs (`Fixes #123` for bugs, `Closes #123` for features/improvements)
- If needed, close manually with GitHub CLI: `gh issue close 123 --comment "Fixed by <commit-or-pr>"`

## Build/Test Commands

- **Install**: `bun install`
- **Dev**: `bun dev` (runs TUI)
- **Test**: `bun test` (runs all tests)
- **Typecheck**: `bun check` (tsc --noEmit)
- **Lint**: `bun lint` (biome check)
- **Lint fix**: `bun lint:fix` (biome check --write)
- **CLI**: `bun cli <command>` (runs CLI commands, e.g., `bun cli comment list -r @`)

## OpenTUI Documentation

Before working on TUI component tasks, check:
- **Local reference**: [`docs/opentui.md`](docs/opentui.md) — component API, patterns, known quirks
- **Upstream docs**: https://github.com/sst/opentui/tree/main/packages/solid
- **Examples**: https://github.com/sst/opentui/tree/main/packages/solid/examples

## Code Style

- **Runtime**: Bun with TypeScript
- **Framework**: OpenTUI (Solid.js-based TUI framework)
- **Formatting**: Biome - tabs, no semicolons
- **Naming**: camelCase for variables/functions, PascalCase for components/types
- **Imports**: Relative imports for local modules
- **Types**: Define interfaces in separate types.ts files when shared

## Bun

- **NEVER** run `bun src/index.tsx` directly - TUI apps will hang. Ask the user to run it manually.
- **NEVER** use `require()` - always use ESM imports at file top
- Use `bun add` to install packages, not `npm install`

## Solid.js

This project uses Solid.js, NOT React. Key differences:

- **State**: Use `createSignal`, not `useState`
  ```tsx
  const [value, setValue] = createSignal("initial")
  ```
- **Reading signals**: Must call as functions: `value()`, not `value`
  ```tsx
  // WRONG: <text>{value}</text>
  // CORRECT: <text>{value()}</text>
  ```
- **Mount effects**: Use `onMount`, not `useEffect`
  ```tsx
  onMount(() => {
    loadData()
  })
  ```
- **Input handling**: `<input>` uses `onInput`, receives string value not event
  ```tsx
  <input onInput={(value) => setValue(value)} />
  ```
- **No dependency arrays**: Solid tracks dependencies automatically - no `useEffect` deps needed

## Architecture

- **Entry**: `src/index.tsx` - renders root App component
- **Commander**: `src/commander/` - jj CLI wrappers and output parsers
- **Components**: `src/components/` - TUI components (panels, modals)
- **Context**: `src/context/` - SolidJS context providers (state management)
- **Keybind**: `src/keybind/` - Keybind registry and parser
- **Theme**: `src/theme/` - Theme definitions and presets (lazygit, opencode)
- **Utils**: `src/utils/` - Shared utilities (file tree, double-click detection)
- **Docs**: `docs/` - specs, design notes, OpenTUI reference

## Testing

- **Unit tests**: `tests/unit/` - mirrors src structure
- **Benchmarks**: `tests/bench/` - performance tests with threshold assertions
- Run all: `bun test`
- Run benchmarks: `bun test tests/bench/`

## Key Patterns

### Focus System (`src/context/focus.tsx`)
Panels have modes like `log.revisions`, `log.files`, `bookmarks.list`, `bookmarks.commits`. Commands register for specific contexts and only activate when that context matches.

### Command Registry (`src/App.tsx`)
Commands are registered with `context`, `type`, and `visibility`. The keybind system routes key presses to the appropriate command based on current focus.

### Dialog System (`src/context/dialog.tsx`)
Modal stack with backdrop overlay. Dialogs push/pop from stack. Theme-aware styling.

### Prefix Injection (Log Parsing)
We inject unique prefixes into `jj log` template output to reliably parse multi-line entries. See `src/commander/log.ts`.

## jj (Jujutsu) Workflow

This repo uses jj, not git directly:
- `jj st` - status
- `jj log` - commit history  
- `jj diff` - show changes
- `jj desc -m "msg"` - set commit message
- `jj new` - create new empty working copy
- `jj squash` - squash into parent

**IMPORTANT: Atomic commits**
After completing an atomic change (a single logical unit of work), run `jj new` to create a new empty working copy. This keeps changes separate and avoids painful splitting later.

- Run `jj new` after each feature, bug fix, or logical change
- `jj describe` is optional — can be done in retrospect
- Don't batch multiple unrelated changes into one commit

## Dependency Updates

Use the `check-deps` skill to stay current on key dependencies:
- **OpenTUI** — TUI framework (breaking changes possible)
- **@pierre/diffs** — Diff parsing library
- **Bun** — Runtime

Run periodically or when debugging unexpected behavior.

## Reference Projects

When unsure about jj TUI patterns, explore these repos:
- **jjui** (Go): https://github.com/idursun/jjui
- **lazyjj** (Rust): https://github.com/Cretezy/lazyjj
- **lazygit** (Go): https://github.com/jesseduffield/lazygit

Use the librarian agent to research specific patterns.

## OpenTUI Component Reference

See [`docs/opentui.md`](docs/opentui.md) for the full component API reference, including:
- Layout components (`box`, `scrollbox`, `text`)
- Input components (`input`, `textarea`, `select`)
- Styling patterns (RGBA, TextAttributes, SyntaxStyle)
- Hooks (`useKeyboard`, `onResize`, `useRenderer`)
- Critical patterns (virtualization, spacer boxes, focus routing)
- Known quirks and workarounds
