# lazierjj Agent Guidelines

## Build/Test Commands

- **Install**: `bun install`
- **Dev**: `bun dev` (runs TUI)
- **Test**: `bun test` (runs all tests)
- **Typecheck**: `bun check` (tsc --noEmit)
- **Lint**: `bun lint` (biome check)
- **Lint fix**: `bun lint:fix` (biome check --write)

## Code Style

- **Runtime**: Bun with TypeScript
- **Framework**: OpenTUI (React-like TUI framework)
- **Formatting**: Biome - tabs, no semicolons
- **Naming**: camelCase for variables/functions, PascalCase for components/types
- **Imports**: Relative imports for local modules
- **Types**: Define interfaces in separate types.ts files when shared

## Architecture

- **Entry**: `src/index.tsx` - renders root App component
- **Commander**: `src/commander/` - jj CLI wrappers and output parsers
- **Components**: `src/components/` - TUI components (planned)
- **Context**: `src/context/` - state management (planned)

## jj (Jujutsu) Workflow

This repo uses jj, not git directly:
- `jj st` - status
- `jj log` - commit history  
- `jj diff` - show changes
- `jj desc -m "msg"` - set commit message
- `jj new` - create new empty working copy
- `jj squash` - squash into parent

## Reference Implementations

When unsure how to implement a jj TUI feature, check these repos:

### jjui (Go) - Primary Reference
- **Repo**: https://github.com/idursun/jjui
- **Why**: Most mature jj TUI, excellent UX patterns
- **Key patterns**:
  - Prefix injection for log parsing (we use this approach)
  - Panel-based navigation
  - Command palette

### lazyjj (Rust) - Secondary Reference  
- **Repo**: https://github.com/Cretezy/lazyjj
- **Why**: Alternative approaches, lazygit-inspired UI
- **Key patterns**:
  - Line-index based parsing (we chose prefix injection instead)
  - Tab-based panel switching

### opencode (TypeScript/Go)
- **Repo**: https://github.com/opencode/opencode
- **Why**: Same tech stack patterns (TypeScript TUI)
- **Key patterns**:
  - SolidJS-based TUI architecture
  - Tool/command patterns
