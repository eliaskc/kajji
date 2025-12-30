# OpenTUI Research Findings

> Research from critique repo and OpenTUI examples (Dec 2025)

## Key Discovery: ghostty-opentui for ANSI Rendering

**Problem**: OpenTUI cannot render raw ANSI escape codes - they appear as garbled text.

**Solution**: Use `ghostty-opentui` package which uses Ghostty's Zig-based terminal emulator for robust ANSI parsing.

### Why ghostty-opentui over regex parsing?

1. **Robustness**: Full VT terminal emulation, not just simple ANSI parsing
2. **Complex styles**: 16/256/RGB colors, bold, italic, underline, strikethrough, faint
3. **Terminal state**: Cursor positioning, line wrapping, scrolling regions
4. **Performance**: Parsing happens at Zig level, not JS

### Usage Options

#### Option 1: Direct Component (simplest)
```tsx
import { extend } from "@opentui/solid"
import { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer"

// Register once at app startup
extend({ "ghostty-terminal": GhosttyTerminalRenderable })

// Use in component
function DiffView({ diffOutput }: { diffOutput: string }) {
  return (
    <scrollbox focused style={{ flexGrow: 1 }}>
      <ghostty-terminal ansi={diffOutput} cols={100} />
    </scrollbox>
  )
}
```

#### Option 2: Manual parsing (more control)
```tsx
import { ptyToJson, type TerminalData } from "ghostty-opentui"

const data: TerminalData = ptyToJson(ansiString, { cols: 80, rows: 24 })
// data.lines[].spans[] contains { text, fg, bg, flags, width }

// Then render manually:
<For each={data.lines}>
  {(line) => (
    <text>
      <For each={line.spans}>
        {(span) => (
          <span style={{ fg: span.fg, bg: span.bg }}>{span.text}</span>
        )}
      </For>
    </text>
  )}
</For>
```

### Output Format
```typescript
interface TerminalData {
  cols: number
  rows: number
  cursor: [number, number]
  totalLines: number
  lines: {
    spans: Array<{
      text: string
      fg: string | null   // Hex color e.g., "#ff5555"
      bg: string | null
      flags: number       // Bitmask: Bold=1, Italic=2, Underline=4
      width: number
    }>
  }[]
}
```

### StyleFlags from ghostty-opentui
```typescript
import { StyleFlags } from "ghostty-opentui"
// StyleFlags.BOLD, StyleFlags.ITALIC, StyleFlags.UNDERLINE, etc.
```

---

## OpenTUI Component Reference (from examples)

### Available Primitives

| Component | Description | Key Props |
|-----------|-------------|-----------|
| `<box>` | Primary layout/container | `border`, `flexDirection`, `flexGrow`, `gap`, `padding` |
| `<text>` | Renders styled text | `content`, `fg`, `bg`, `paddingTop` |
| `<span>` | Inline text styling inside `<text>` | `style={{ fg, bg, attributes }}` |
| `<scrollbox>` | Virtualized scrollable container | `focused`, `stickyScroll`, `scrollbarOptions` |
| `<input>` | Single-line text input | `value`, `onInput`, `placeholder`, `focused` |
| `<textarea>` | Multi-line text editor | `value`, `onInput`, `wrap` |
| `<select>` | List selection with navigation | `options`, `onSelect`, `showScrollIndicator` |
| `<diff>` | Optimized diff viewer | `diff`, `view="unified"|"split"`, `syntaxStyle` |
| `<code>` | Syntax highlighted code | `content`, `filetype`, `syntaxStyle` |
| `<ascii_font>` | ASCII art text | `text`, `style={{ font: "tiny"|... }}` |

### Borders & Backgrounds
```tsx
<box 
  border={true}                // or ["left", "right"] for partial
  borderStyle="rounded"        // "single" | "double" | "rounded"
  borderColor="#4ECDC4"
  backgroundColor="#0D1117"
  title="My Panel"
  titleAlignment="center"
>
```

### Layout (Flexbox)
```tsx
<box flexDirection="row" gap={2} alignItems="center">
  <box width="30%" height={10} border> Sidebar </box>
  <box flexGrow={1} border> Main Content </box>
</box>
```

Sizing options:
- **Fixed**: `width={50}`, `height={20}`
- **Percentage**: `width="100%"`, `height="50%"`
- **Auto**: `flexGrow={1}` (consumes remaining space)

### Text Formatting
```tsx
import { TextAttributes } from "@opentui/core"

// Colors and attributes
<text style={{ fg: "yellow", bg: "blue", attributes: TextAttributes.UNDERLINE }}>
  Styled Text
</text>

// Helper components
<text>
  <b>Bold</b> <u>Underline</u> <i>Italic</i>
</text>

// Line breaks and links
<text>
  Line one
  <br />
  Line two with <span style={{ fg: "red" }}>Red Text</span>
  <br />
  <u><a href="https://opentui.com" style={{ fg: "blue" }}>Link</a></u>
</text>
```

### Input Handling
```tsx
import { useKeyboard } from "@opentui/solid"

useKeyboard((key) => {
  if (key.name === "v" && !key.ctrl) {
    toggleView()
  }
  // key.raw provides access to the raw ANSI sequence
})

// Interactive input
const [value, setValue] = createSignal("")
<input 
  focused 
  onInput={(v) => setValue(v)} 
  placeholder="Type something..."
/>
```

---

## OpenTUI Examples Summary

### scrollbox - Scrollable Content
```tsx
<scrollbox
  scrollbarOptions={{ visible: true }}
  stickyScroll={true}
  stickyStart="bottom"
  focused
  contentOptions={{
    flexGrow: 1,
    gap: 1,
  }}
>
  {/* content */}
</scrollbox>
```

Key props:
- `focused`: Enable keyboard scrolling
- `stickyScroll` + `stickyStart="bottom"`: Auto-scroll to bottom (chat-style)
- `scrollbarOptions`: Configure scrollbar visibility

### diff - Built-in Diff Rendering
```tsx
import { SyntaxStyle } from "@opentui/core"

<diff
  diff={unifiedDiffString}
  view="unified" // or "split"
  filetype="typescript"
  syntaxStyle={syntaxStyle}
  showLineNumbers={true}
  addedBg="#1a4d1a"
  removedBg="#4d1a1a"
  addedSignColor="#22c55e"
  removedSignColor="#ef4444"
  lineNumberFg="#6b7280"
  lineNumberBg="#161b22"
/>
```

**Note**: We probably won't use `<diff>` because we want to honor user's configured diff tool (difftastic, delta, etc.) which outputs ANSI. Use ghostty-opentui instead.

### code - Syntax Highlighting
```tsx
import { SyntaxStyle, RGBA } from "@opentui/core"

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#ff6b6b"), bold: true },
  string: { fg: RGBA.fromHex("#51cf66") },
  comment: { fg: RGBA.fromHex("#868e96"), italic: true },
  number: { fg: RGBA.fromHex("#ffd43b") },
  default: { fg: RGBA.fromHex("#ffffff") },
})

<code content={codeString} filetype="javascript" syntaxStyle={syntaxStyle} />
```

### Text Styling
```tsx
import { TextAttributes } from "@opentui/core"

// Style prop on text
<text style={{ bg: "red", fg: "black" }}>Colored text</text>

// Inline spans
<text>
  Normal <span style={{ fg: "#ff0000", bg: "#000" }}>red on black</span>
</text>

// Text attributes
<span style={{ attributes: TextAttributes.UNDERLINE, fg: "blue" }}>underlined</span>

// Semantic tags
<b>bold</b>
<i>italic</i>
<u>underlined</u>

// Hyperlinks (if terminal supports OSC 8)
<a href="https://example.com" style={{ fg: "blue" }}>link</a>
```

### Responsive Layout
```tsx
import { useOnResize } from "@opentui/solid"

const [width, setWidth] = createSignal(80)

useOnResize((newWidth) => {
  setWidth(newWidth)
})

const useSplitView = () => width() >= 100
```

---

## critique Architecture Patterns

### State Management
- Uses **Zustand** for global state
- React `useState`/`useEffect` for local state
- Could translate to SolidJS signals + createStore

### Component Organization
- Dropdown component for fuzzy search/selection
- Modal overlays via conditional rendering (not z-index)
- Theme system with JSON-defined themes

### ANSI Handling in critique
```typescript
// From critique's ansi-html.ts
import { ptyToJson, StyleFlags } from "ghostty-opentui"

// Parse ANSI
const data = ptyToJson(input, { cols: 500, rows: 256 })

// Access style flags
if (span.flags & StyleFlags.BOLD) { /* bold */ }
if (span.flags & StyleFlags.ITALIC) { /* italic */ }
if (span.flags & StyleFlags.UNDERLINE) { /* underline */ }
```

---

## Implementation Plan for lazierjj

### Phase 1: Install ghostty-opentui
```bash
bun add ghostty-opentui
```

### Phase 2: Update diff commander
```typescript
// src/commander/diff.ts
// Change from --color never to --color always
export async function getDiff(changeId: string): Promise<string> {
  return execute(["diff", "-r", changeId, "--color", "always"])
}
```

### Phase 3: Create ANSI renderer component
```tsx
// src/components/AnsiText.tsx
import { For } from "solid-js"
import { ptyToJson } from "ghostty-opentui"

interface Props {
  content: string
  cols?: number
}

export function AnsiText(props: Props) {
  const data = () => ptyToJson(props.content, { cols: props.cols ?? 80 })
  
  return (
    <For each={data().lines}>
      {(line) => (
        <text>
          <For each={line.spans}>
            {(span) => (
              <span style={{ fg: span.fg ?? undefined, bg: span.bg ?? undefined }}>
                {span.text}
              </span>
            )}
          </For>
        </text>
      )}
    </For>
  )
}
```

### Phase 4: Use in MainArea
```tsx
// src/components/panels/MainArea.tsx
import { AnsiText } from "../AnsiText"

// Replace plain text rendering with:
<scrollbox focused>
  <AnsiText content={diff()} cols={80} />
</scrollbox>
```

---

## Open Questions

1. **Performance**: How does ghostty-opentui perform with large diffs (1000+ lines)?
   - Use `limit` prop on ghostty-terminal component
   - Or implement virtual scrolling

2. **SolidJS vs React**: critique uses @opentui/react, we use @opentui/solid
   - API should be similar, but need to verify ghostty-opentui works with solid

3. **extend() for custom components**: Does @opentui/solid support `extend()`?
   - May need to use manual ptyToJson approach instead of <ghostty-terminal>
