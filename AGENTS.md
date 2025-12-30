# lazierjj Agent Guidelines

## Build/Test Commands

- **Install**: `bun install`
- **Dev**: `bun dev` (runs TUI)
- **Test**: `bun test` (runs all tests)
- **Typecheck**: `bun check` (tsc --noEmit)
- **Lint**: `bun lint` (biome check)
- **Lint fix**: `bun lint:fix` (biome check --write)

## OpenTUI Documentation

Before working on TUI component tasks, read the OpenTUI Solid docs:
```bash
curl -s https://raw.githubusercontent.com/sst/opentui/refs/heads/main/packages/solid/README.md
```

For examples, use gitchamber:
```bash
# List all Solid examples
curl -s "https://gitchamber.com/repos/sst/opentui/main/files?glob=packages/solid/examples/**"

# Read specific example (e.g., input handling)
curl -s "https://gitchamber.com/repos/sst/opentui/main/files/packages/solid/examples/components/input-demo.tsx?glob=**/*.tsx"
```

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

### critique (TypeScript) - OpenTUI Reference
- **Repo**: https://github.com/remorses/critique
- **Why**: Production OpenTUI app with ANSI rendering, diff views, themes
- **Key patterns**:
  - Uses `ghostty-opentui` for ANSI→styled rendering
  - Shiki for syntax highlighting
  - `<scrollbox>` for scrollable content
  - Responsive layout with `useOnResize`

## OpenTUI Component Reference

### Layout & Containers
- **`<box>`**: Primary layout container (like div). Props: `flexDirection`, `flexGrow`, `padding`, `border`, `borderColor`, `backgroundColor`, `gap`
- **`<scrollbox>`**: Scrollable container. Props: `focused`, `stickyScroll`, `stickyStart="bottom"`, `scrollbarOptions={{ visible: true }}`

### Text & Styling
- **`<text>`**: Text display. Props: `fg`, `bg`, `content`
- **`<span>`**: Inline text styling. Props: `style={{ fg, bg, attributes }}`
- **`<b>`, `<i>`, `<u>`**: Bold, italic, underline wrappers
- **`TextAttributes`**: Import from `@opentui/core` for `UNDERLINE`, `BOLD`, etc.

### Specialized Components
- **`<diff>`**: Git diff rendering. Props: `diff`, `view="unified"|"split"`, `filetype`, `syntaxStyle`, `showLineNumbers`
- **`<code>`**: Syntax highlighted code. Props: `content`, `filetype`, `syntaxStyle`
- **`<input>`**: Text input field. Props: `focused`, `onInput`, `onSubmit`, `placeholder`, `ref`
  - `onInput` receives `(value: string)` NOT an event object
  - `onSubmit` fires on Enter key
  - Use `ref` for programmatic control (e.g., `inputRef.insertText(text)`)

### Hooks
- **`useKeyboard(callback)`**: Keyboard input handling
- **`useOnResize(callback)`**: Terminal resize handling

### ANSI Rendering (ghostty-opentui)
For rendering colored CLI output (like `jj diff --color always`):
```tsx
import { ptyToJson } from "ghostty-opentui"
// Parse ANSI to JSON structure with lines/spans
const data = ptyToJson(ansiString, { cols: 80, rows: 24 })
// data.lines[].spans[] contains { text, fg, bg, flags }
```

### Styling Patterns
```tsx
// Box with background and border
<box backgroundColor="#1a1b26" border borderColor="#4ECDC4" padding={1}>

// Text with foreground color
<text fg="#00ff00">Green text</text>

// Inline styled spans
<text>
  Normal <span style={{ fg: "#ff0000", bg: "#000" }}>red on black</span>
</text>

// Text attributes
<span style={{ attributes: TextAttributes.UNDERLINE, fg: "blue" }}>underlined</span>
```
