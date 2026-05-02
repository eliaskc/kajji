# kajji Agent Guidelines

Follow the Boy Scout rule:
- For minor things, just improve them
- For larger improvements, create a GitHub issue or lift to the user
- If you see a lack of testing in an area, offer to add

## Task management

All work is tracked in [GitHub Issues](https://github.com/eliaskc/kajji/issues).

- Check existing issues before starting work
- Create issues for new bugs, features, improvements
- Use labels: `bug`, `feature`, `needs-exploration`, `ui-polish`, `tech-debt`, `docs`
- Use Conventional Commits for commit messages (`feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, `test(scope): ...`, `refactor(scope): ...`, `chore(scope): ...`)
- Reference issues in commit messages when applicable
- Close issues when work is done: prefer magic words in commits/PRs (`Fixes #123` for bugs, `Closes #123` for features/improvements)
- If needed, close manually with GitHub CLI: `gh issue close 123 --comment "Fixed by <commit-or-pr>"`

## Build/Test Commands

- **Install**: `bun install`
- **Dev**: `bun dev` (runs TUI)
- **Test**: `bun test` (runs unit tests)
- **Benchmarks**: `bun test:bench` (runs benchmark tests)
- **Typecheck**: `bun check` (tsc --noEmit)
- **Lint**: `bun lint` (biome check)
- **Lint fix**: `bun lint:fix` (biome check --write)
- **Schema**: `bun generate:schema` (updates generated config schema)
- **CLI/TUI entry**: `bun cli` (runs the app without watch mode)

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

- **Entry**: `src/index.tsx` - process entrypoint; `src/tui.tsx` boots the TUI; `src/App.tsx` renders the root app
- **CLI**: `src/cli/` - non-TUI command modules and formatting helpers
- **Commander**: `src/commander/` - jj/gh CLI wrappers, streaming execution, and output parsers
- **Comments**: `src/comments/` - GitHub comment metadata and relocation utilities
- **Components**: `src/components/` - TUI components, including `panels/`, `modals/`, and diff views
- **Config**: `src/config/` - config loading, defaults, and Zod schema
- **Context**: `src/context/` - SolidJS providers for focus, commands, dialogs, sync, keybinds, loading, layout, and theme
- **Diff**: `src/diff/` - diff parsing/formatting types and helpers
- **Hooks**: `src/hooks/` - shared Solid/OpenTUI hooks
- **Keybind**: `src/keybind/` - default keybind definitions, registry, parser, and display helpers
- **Theme**: `src/theme/` - theme definitions and presets (lazygit, opencode)
- **Types**: `src/types/` - shared type definitions
- **Utils**: `src/utils/` - shared utilities (file tree, editor launch, status colors, double-click detection)
- **Docs**: `docs/` - specs, design notes, OpenTUI reference

## Testing

- **Unit tests**: `tests/unit/` - mirrors src structure
- **Benchmarks**: `tests/bench/` - performance tests with threshold assertions
- Run all: `bun test`
- Run benchmarks: `bun test tests/bench/`

## Key Patterns

### Focus System (`src/context/focus.tsx`)
Panels have contexts like `log.revisions`, `log.files`, `log.oplog`, `refs.bookmarks`, `detail`, and `commandlog`. Commands register for specific contexts and only activate when that context matches.

### Command Registry (`src/context/command.tsx`, registrations in panels/App)
Commands are registered with `context`, `type`, `panel`, and `visibility`. The keybind system routes key presses to the appropriate command based on current focus. `visibility: "help-only"` hides a command from the status bar; `"status-only"` hides it from help; omit visibility to show in both.

### Dialog System (`src/context/dialog.tsx`)
Modal stack with backdrop overlay. Dialogs push/pop from stack. Theme-aware styling.

### Prefix Injection (Log Parsing)
We inject unique prefixes into `jj log` template output to reliably parse multi-line entries. See `src/commander/log.ts`.

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
