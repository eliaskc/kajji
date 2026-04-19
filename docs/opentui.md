# OpenTUI Reference

> Framework: [@opentui/solid](https://github.com/sst/opentui)
> Last validated: 2026-04-19 (0.1.100)

---

## Components Overview

### Layout & Display
- `text` — styled text container
- `box` — layout container with borders, padding, and flex settings
- `scrollbox` — scrollable container
- `ascii_font` — ASCII art text renderer

### Input
- `input` — single-line text input
- `textarea` — multi-line text input
- `select` — list selection
- `tab_select` — tab-based selection

### Code & Diff
- `code` — syntax-highlighted code blocks
- `line_number` — line-numbered code display with diff/diagnostic helpers
- `diff` — unified or split diff viewer

### Text Modifiers
Must appear inside a `text` component:
- `span` — inline styled text
- `strong`/`b` — bold text
- `em`/`i` — italic text
- `u` — underline text
- `br` — line break
- `a` — link text with `href`

---

## Layout Components

### box (Flexbox Container)

```tsx
<box
  flexDirection="row"     // "row" | "column"
  flexGrow={1}            // number
  flexShrink={0}          // number
  flexBasis={0}           // number | "auto"
  gap={1}                 // number
  padding={1}             // number | [top, right, bottom, left]
  width="100%"            // number | string
  height={10}             // number | string
  alignItems="center"     // "flex-start" | "center" | "flex-end"
  justifyContent="center" // "flex-start" | "center" | "flex-end" | "space-between"
  border                  // boolean
  borderStyle="rounded"   // "single" | "double" | "rounded"
  borderColor="#4ECDC4"
  backgroundColor="#1a1b26"
  overflow="hidden"       // "visible" | "hidden"
>
```

### scrollbox (Scrollable)

```tsx
<scrollbox
  focused={isFocused()}
  stickyScroll={true}           // Auto-scroll to new content
  stickyStart="bottom"          // "top" | "bottom"
  scrollbarOptions={{ 
    visible: true,
    style: { fg: "#666" }
  }}
  contentOptions={{
    flexGrow: 1,
    gap: 1,
  }}
>
  {/* Long content */}
</scrollbox>
```

### text

```tsx
<text
  fg="#ffffff"
  bg="#000000"
  content="Or use content prop"
  wrapMode="word"         // "none" | "char" | "word"
  attributes={TextAttributes.BOLD}
>
  Text with children
</text>
```

---

## Input Components

### input (Single-line)

```tsx
<input
  focused={isFocused()}
  placeholder="Enter text..."
  onInput={(value: string) => setValue(value)}
  onSubmit={(value: string) => handleSubmit(value)}
  ref={inputRef}
/>
```

**Notes:**
- `onInput` receives `(value: string)` NOT an event object
- `onSubmit` fires on Enter key
- Use `ref` for programmatic control (e.g., `inputRef.insertText(text)`)

### textarea (Multi-line)

```tsx
<textarea
  focused={isFocused()}
  placeholder="Enter multi-line text..."
  onInput={(value: string) => setValue(value)}
  onSubmit={(value: string) => handleSubmit(value)}
/>
```

---

## Styling

### Inline Color Props

```tsx
// Direct hex strings
<text fg="#ff0000">Red</text>
<box backgroundColor="#1a1b26" borderColor="#4ECDC4" />

// Named colors (terminal palette)
<text fg="red">Red</text>
<text fg="brightBlue">Bright Blue</text>
```

### RGBA Class

```typescript
import { RGBA } from "@opentui/core"

const primary = RGBA.fromHex("#4ECDC4")
const withAlpha = RGBA.fromHex("#4ECDC4").withAlpha(0.5)

<box backgroundColor={primary} />
```

### Text Attributes

```tsx
import { TextAttributes } from "@opentui/core"

// Bitmask style
<text attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE}>
  Bold and underlined
</text>

// Semantic wrappers
<text>
  <b>Bold</b> and <u>underlined</u> and <i>italic</i>
</text>
```

### SyntaxStyle for Code/Diff

```typescript
import { SyntaxStyle, RGBA } from "@opentui/core"

const syntaxTheme = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#C792EA"), bold: true },
  string: { fg: RGBA.fromHex("#C3E88D") },
  comment: { fg: RGBA.fromHex("#676E95"), italic: true },
  function: { fg: RGBA.fromHex("#82AAFF") },
  number: { fg: RGBA.fromHex("#F78C6C") },
  default: { fg: RGBA.fromHex("#A6ACCD") },
})

<diff syntaxStyle={syntaxTheme} ... />
<code syntaxStyle={syntaxTheme} ... />
```

### Inline Styled Spans

```tsx
<text>
  Normal <span style={{ fg: "#ff0000", bg: "#000" }}>red on black</span>
</text>

// Text attributes
<span style={{ attributes: TextAttributes.UNDERLINE, fg: "blue" }}>underlined</span>
```

---

## Hooks

### useKeyboard

```typescript
import { useKeyboard } from "@opentui/solid"

useKeyboard((key) => {
  // Key object properties:
  // - name: string (e.g., "a", "enter", "escape", "up")
  // - raw: string (raw ANSI sequence)
  // - ctrl: boolean
  // - meta: boolean
  // - shift: boolean
  // - alt: boolean
  
  if (key.ctrl && key.name === "c") {
    renderer.stop()
    process.exit(0)
  }
  
  switch (key.name) {
    case "j":
    case "down":
      selectNext()
      break
  }
})
```

### onResize

```typescript
import { onResize } from "@opentui/solid"

const [width, setWidth] = createSignal(80)

onResize((newWidth, newHeight) => {
  setWidth(newWidth)
})

// Responsive layout
const showSidebar = () => width() >= 100
```

### useRenderer

```typescript
import { useRenderer } from "@opentui/solid"

const renderer = useRenderer()

// Quit
renderer.destroy()
process.exit(0)

// Toggle debug console
renderer.console.toggle()

// Get terminal palette
const palette = renderer.getPalette()
```

### usePaste

```typescript
import { usePaste } from "@opentui/solid"

usePaste((text) => {
  // Handle pasted text
})
```

### useTerminalDimensions

```typescript
import { useTerminalDimensions } from "@opentui/solid"

const { width, height } = useTerminalDimensions()
```

---

## ANSI Rendering (ghostty-opentui)

For rendering colored CLI output (like `jj diff --color always`):

```tsx
import { ptyToJson } from "ghostty-opentui"

// Parse ANSI to JSON structure with lines/spans
const data = ptyToJson(ansiString, { cols: 80, rows: 24 })
// data.lines[].spans[] contains { text, fg, bg, flags }
```

---

## Portals & Dynamic

### Portal

Render children into a different mount node, useful for overlays:

```tsx
import { Portal } from "@opentui/solid"

<Portal mount={renderer.root}>
  <box border>Overlay</box>
</Portal>
```

### Dynamic

Render arbitrary intrinsic elements dynamically:

```tsx
import { Dynamic } from "@opentui/solid"

<Dynamic component={isMultiline() ? "textarea" : "input"} />
```

---

## Critical Patterns

### Spacer Elements & Virtualization

**CRITICAL: Empty boxes require flexShrink={0}**

When using `<box height={N}>` as a spacer element (e.g., for virtualization), you **MUST** add `flexShrink={0}` or the box will collapse to 0 height in flex containers.

```tsx
// WRONG - will collapse in flex container
<box height={50} />

// CORRECT - maintains height
<box height={50} flexShrink={0} />
```

### Virtualization Pattern

For row virtualization in scrollable content:

```tsx
<box flexDirection="column">
  {/* Top spacer - represents rows above viewport */}
  <box height={visibleRange().start} flexShrink={0} />
  
  {/* Only render visible rows */}
  <For each={visibleRows()}>
    {(row) => <Row row={row} />}
  </For>
  
  {/* Bottom spacer - represents rows below viewport */}
  <box height={totalRows - visibleRange().end} flexShrink={0} />
</box>
```

### ScrollBox Coordinates

- `scrollRef.scrollTop` returns **row index**, not pixels
- `scrollRef.viewport?.height` returns **number of visible rows**
- `scrollRef.scrollTo(index)` scrolls to a **row index**

### Focus-Based Key Routing

Components with `focused` prop handle their own keyboard events:

```tsx
// Parent manages focus
const [focused, setFocused] = createSignal<"list" | "input">("list")

return (
  <box>
    <select 
      focused={focused() === "list"}
      options={items}
      onSelect={handleSelect}
    />
    <input 
      focused={focused() === "input"}
      onSubmit={handleSubmit}
    />
  </box>
)
```

- **Global keys** (quit, help) — Handle in root `useKeyboard`
- **Local keys** — Let focused component handle via its props

---

## Known Quirks

### Box title styling limitation

`<box title="">` only accepts plain strings (passed to Zig renderer). To style parts of the title differently (e.g., highlight active tab), use the sibling overlay pattern — see [docs/PROJECT.md](./PROJECT.md#borderbox-pattern).

### Signal reading

Must call signals as functions: `value()`, not `value`

```tsx
// WRONG: <text>{value}</text>
// CORRECT: <text>{value()}</text>
```

---

## External References

- **OpenTUI repo:** https://github.com/sst/opentui
- **Docs:** https://github.com/sst/opentui/tree/main/packages/solid
- **Examples:** https://github.com/sst/opentui/tree/main/packages/solid/examples
