# OpenTUI ScrollBox Component - Official Documentation

**Repository**: [sst/opentui](https://github.com/sst/opentui)  
**Commit SHA**: `e8c1233678e5d1660f9ea2d9e064bd4134454efb`

---

## 1. Component Props & API

### ScrollBoxProps Type Definition

**Source**: [packages/solid/src/types/elements.ts#L147-L151](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/src/types/elements.ts#L147-L151)

```typescript
export type ScrollBoxProps = ComponentProps<ContainerProps<ScrollBoxOptions>, ScrollBoxRenderable> & {
  focused?: boolean
  stickyScroll?: boolean
  stickyStart?: "bottom" | "top" | "left" | "right"
}
```

### ScrollBoxOptions Interface

**Source**: [packages/core/src/renderables/ScrollBox.ts#L44-L58](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/core/src/renderables/ScrollBox.ts#L44-L58)

```typescript
export interface ScrollBoxOptions extends BoxOptions<ScrollBoxRenderable> {
  rootOptions?: BoxOptions
  wrapperOptions?: BoxOptions
  viewportOptions?: BoxOptions
  contentOptions?: BoxOptions
  scrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  verticalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  horizontalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">
  stickyScroll?: boolean
  stickyStart?: "bottom" | "top" | "left" | "right"
  scrollX?: boolean
  scrollY?: boolean
  scrollAcceleration?: ScrollAcceleration
  viewportCulling?: boolean
}
```

### Key Properties

| Property | Type | Description |
|----------|------|-------------|
| `focused` | `boolean` | Makes the scrollbox focusable and responsive to keyboard input |
| `stickyScroll` | `boolean` | Enables sticky scroll behavior (auto-scroll to edge when content is added) |
| `stickyStart` | `"bottom" \| "top" \| "left" \| "right"` | Which edge to stick to when `stickyScroll` is enabled |
| `scrollX` | `boolean` | Enable horizontal scrolling |
| `scrollY` | `boolean` | Enable vertical scrolling |
| `scrollAcceleration` | `ScrollAcceleration` | Custom scroll acceleration algorithm (LinearScrollAccel, MacOSScrollAccel, etc.) |
| `viewportCulling` | `boolean` | Optimize rendering by only rendering visible children |
| `rootOptions` | `BoxOptions` | Style the root container |
| `wrapperOptions` | `BoxOptions` | Style the wrapper layer |
| `viewportOptions` | `BoxOptions` | Style the viewport (visible area) |
| `contentOptions` | `BoxOptions` | Style the content container |
| `scrollbarOptions` | `ScrollBarOptions` | Configure both scrollbars |
| `verticalScrollbarOptions` | `ScrollBarOptions` | Configure vertical scrollbar only |
| `horizontalScrollbarOptions` | `ScrollBarOptions` | Configure horizontal scrollbar only |

---

## 2. Basic Usage Example

**Source**: [packages/solid/examples/components/scroll-demo.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/examples/components/scroll-demo.tsx)

### Simple ScrollBox with For Loop

```tsx
import { createMemo, For } from "solid-js"

export const ScrollDemo = () => {
  const objectItems = createMemo(() => 
    Array.from({ length: 1000 }).map((_, i) => ({ count: i + 1 }))
  )

  return (
    <scrollbox
      style={{
        width: "100%",
        height: "100%",
        flexGrow: 1,
        rootOptions: {
          backgroundColor: "#24283b",
          border: true,
        },
        wrapperOptions: {
          backgroundColor: "#1f2335",
        },
        viewportOptions: {
          backgroundColor: "#1a1b26",
        },
        contentOptions: {
          backgroundColor: "#16161e",
        },
        scrollbarOptions: {
          showArrows: true,
          trackOptions: {
            foregroundColor: "#7aa2f7",
            backgroundColor: "#414868",
          },
        },
      }}
      focused
    >
      <For each={objectItems()}>
        {(item) => (
          <box
            style={{
              width: "100%",
              padding: 1,
              marginBottom: 1,
              backgroundColor: item.count % 2 === 0 ? "#292e42" : "#2f3449",
            }}
          >
            <text content={`Box ${item.count}`} />
          </box>
        )}
      </For>
    </scrollbox>
  )
}
```

### Using Index for Primitive Arrays

```tsx
export const ScrollDemoIndex = () => {
  const primitiveItems = createMemo(() => 
    Array.from({ length: 1000 }).map((_, i) => i + 1)
  )

  return (
    <scrollbox
      style={{
        width: "100%",
        height: "100%",
        flexGrow: 1,
        rootOptions: { backgroundColor: "#24283b", border: true },
        wrapperOptions: { backgroundColor: "#1f2335" },
        viewportOptions: { backgroundColor: "#1a1b26" },
        contentOptions: { backgroundColor: "#16161e" },
        scrollbarOptions: {
          showArrows: true,
          trackOptions: {
            foregroundColor: "#7aa2f7",
            backgroundColor: "#414868",
          },
        },
      }}
      focused
    >
      <Index each={primitiveItems()}>
        {(item) => (
          <box
            style={{
              width: "100%",
              padding: 1,
              marginBottom: 1,
              backgroundColor: item() % 2 === 0 ? "#292e42" : "#2f3449",
            }}
          >
            <text content={`Box ${item()}`} />
          </box>
        )}
      </Index>
    </scrollbox>
  )
}
```

---

## 3. Sticky Scroll (Auto-Scroll to Bottom)

**Source**: [packages/solid/tests/sticky-scroll.test.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/tests/sticky-scroll.test.tsx)

Sticky scroll automatically keeps the scrollbox at the specified edge when new content is added. Perfect for chat applications and log viewers.

### Basic Sticky Scroll Setup

```tsx
<scrollbox
  ref={(r) => (scrollRef = r)}
  width={40}
  height={10}
  stickyScroll={true}
  stickyStart="bottom"
>
  <For each={items()}>
    {(item) => (
      <box>
        <text>{item}</text>
      </box>
    )}
  </For>
</scrollbox>
```

### Key Behaviors

1. **Auto-scroll on content addition**: When `stickyScroll={true}` and `stickyStart="bottom"`, the scrollbox automatically scrolls to the bottom when new items are added
2. **Manual scroll detection**: If user manually scrolls away from the sticky edge, sticky scroll is disabled until they scroll back
3. **Threshold-based**: Only activates sticky scroll when there's meaningful scrollable content (threshold > 1px)
4. **Programmatic scroll support**: You can still use `scrollTo()` and `scrollBy()` methods; they won't disable sticky scroll if you're scrolling to the sticky edge

### Sticky Scroll Test Cases

**Test 1: Sticky scroll stays at bottom after scrollBy/scrollTo**
```tsx
// Sticky scroll maintains position at bottom as content is added
for (let i = 1; i < 30; i++) {
  setItems((prev) => [...prev, `Line ${i}`])
  await testSetup.renderOnce()
  
  const maxScroll = Math.max(0, scrollRef!.scrollHeight - scrollRef!.viewport.height)
  expect(scrollRef!.scrollTop).toBe(maxScroll) // Always at bottom
}
```

**Test 2: Manual scroll disables sticky scroll**
```tsx
// User can manually scroll up/down
scrollRef.scrollTo(0)  // Scroll to top
await testSetup.renderOnce()
expect(scrollRef.scrollTop).toBe(0)

scrollRef.scrollBy(5)  // Scroll down 5 units
await testSetup.renderOnce()
expect(scrollRef.scrollTop).toBe(5)

// Scroll back to bottom to re-enable sticky
const maxScroll = Math.max(0, scrollRef.scrollHeight - scrollRef.viewport.height)
scrollRef.scrollTo(maxScroll)
```

**Test 3: Accidental scroll when no scrollable content doesn't disable sticky**
```tsx
// Scrolling attempts when content is smaller than viewport don't disable sticky
scrollRef.scrollBy(100)
scrollRef.scrollTo(50)
scrollRef.scrollTop = 10

// _hasManualScroll remains false because there's no meaningful scrollable content
expect((scrollRef as any)._hasManualScroll).toBe(false)

// When content becomes scrollable, sticky scroll still works
for (let i = 0; i < 30; i++) {
  setItems((prev) => [...prev, `Line ${i}`])
  // Sticky scroll automatically maintains bottom position
}
```

---

## 4. Scroll Acceleration

**Source**: [packages/solid/examples/components/custom-scroll-accel-demo.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/examples/components/custom-scroll-accel-demo.tsx)

OpenTUI provides multiple scroll acceleration algorithms for smooth scrolling behavior.

### Built-in Acceleration Types

```tsx
import { LinearScrollAccel, MacOSScrollAccel } from "@opentui/core"

// Linear (no acceleration)
new LinearScrollAccel()

// macOS-style smooth acceleration
new MacOSScrollAccel({ A: 0.5, tau: 4, maxMultiplier: 4 })
```

### Custom Scroll Acceleration Example

```tsx
/**
 * Custom scroll acceleration that applies a simple quadratic curve
 */
class QuadraticScrollAccel {
  private lastTickTime = 0
  private tickCount = 0
  private readonly streakTimeout = 150
  private readonly maxMultiplier = 3

  tick(now = Date.now()): number {
    const dt = this.lastTickTime ? now - this.lastTickTime : Infinity

    // Reset streak if too much time has passed
    if (dt === Infinity || dt > this.streakTimeout) {
      this.lastTickTime = now
      this.tickCount = 0
      return 1
    }

    this.lastTickTime = now
    this.tickCount++

    // Apply quadratic acceleration: multiplier grows with consecutive ticks
    // Formula: 1 + (tickCount / 8)^2
    const multiplier = 1 + Math.pow(this.tickCount / 8, 2)

    return Math.min(multiplier, this.maxMultiplier)
  }

  reset(): void {
    this.lastTickTime = 0
    this.tickCount = 0
  }
}
```

### Using Custom Acceleration in ScrollBox

```tsx
export const CustomScrollAccelDemo = () => {
  const items = createMemo(() => 
    Array.from({ length: 1000 }).map((_, i) => ({ count: i + 1 }))
  )
  const [accelType, setAccelType] = createSignal<"linear" | "macos" | "quadratic">("macos")

  const scrollAcceleration = createMemo(() => {
    switch (accelType()) {
      case "linear":
        return new LinearScrollAccel()
      case "macos":
        return new MacOSScrollAccel({ A: 0.5, tau: 4, maxMultiplier: 4 })
      case "quadratic":
        return new QuadraticScrollAccel()
    }
  })

  return (
    <scrollbox
      style={{
        width: "100%",
        flexGrow: 1,
        rootOptions: { backgroundColor: "#24283b", border: true },
        scrollbarOptions: {
          showArrows: true,
          trackOptions: {
            foregroundColor: "#7aa2f7",
            backgroundColor: "#414868",
          },
        },
      }}
      scrollAcceleration={scrollAcceleration()}
      focused
    >
      <For each={items()}>
        {(item) => (
          <box style={{ width: "100%", padding: 1, marginBottom: 1 }}>
            <text content={`Item ${item.count}`} />
          </box>
        )}
      </For>
    </scrollbox>
  )
}
```

---

## 5. Scroll Methods & Properties

**Source**: [packages/core/src/renderables/ScrollBox.ts#L115-L150](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/core/src/renderables/ScrollBox.ts#L115-L150)

### Scroll Position Properties

```typescript
// Get/set vertical scroll position
get scrollTop(): number
set scrollTop(value: number)

// Get/set horizontal scroll position
get scrollLeft(): number
set scrollLeft(value: number)

// Get total scrollable height
get scrollHeight(): number

// Get total scrollable width
get scrollWidth(): number

// Get viewport dimensions
viewport: BoxRenderable  // Has .width and .height properties
```

### Scroll Methods

```typescript
// Scroll by a relative amount
scrollBy(amount: number): void

// Scroll to an absolute position
scrollTo(position: number): void
```

### Sticky Scroll Properties

```typescript
// Enable/disable sticky scroll
get stickyScroll(): boolean
set stickyScroll(value: boolean)

// Set which edge to stick to
get stickyStart(): "bottom" | "top" | "left" | "right" | undefined
set stickyStart(value: "bottom" | "top" | "left" | "right" | undefined)
```

### Example: Programmatic Scrolling

```tsx
let scrollRef: ScrollBoxRenderable | undefined

<scrollbox ref={(r) => (scrollRef = r)} focused stickyScroll={true} stickyStart="bottom">
  {/* content */}
</scrollbox>

// Later, scroll to bottom
if (scrollRef) {
  scrollRef.scrollTo(scrollRef.scrollHeight)
}

// Or scroll by relative amount
if (scrollRef) {
  scrollRef.scrollBy(10)
}
```

---

## 6. Real-World Example: Chat Application

**Source**: [packages/solid/examples/session.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/examples/session.tsx)

This example demonstrates a chat-like interface with streaming messages and sticky scroll.

```tsx
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  fullContent: string
  timestamp: Date
  isComplete: boolean
}

export function Session() {
  const [messages, setMessages] = createStore<{ data: Message[] }>({ data: [] })
  let [isChunkingActive, setIsChunkingActive] = createSignal(false)

  const generateMessage = (): Message => {
    const role = Math.random() > 0.5 ? "user" : "assistant"
    return {
      id: Math.random().toString(36).substring(2, 9),
      role,
      content: "",
      fullContent: "Your message content here...",
      timestamp: new Date(),
      isComplete: false,
    }
  }

  const addMessage = () => {
    if (isChunkingActive()) return

    const newMessage = generateMessage()
    setMessages("data", messages.data.length, newMessage)

    setIsChunkingActive(true)
    startChunkingMessage(newMessage.id, newMessage.fullContent)
  }

  const startChunkingMessage = (messageId: string, fullContent: string) => {
    let currentIndex = 0
    const chunkSize = Math.floor(Math.random() * 5) + 1

    const chunkInterval = setInterval(() => {
      setMessages(
        "data",
        produce((ms) => {
          const message = ms.find((m) => m.id === messageId)
          if (message) {
            message.content = fullContent.slice(0, currentIndex + chunkSize)
            message.isComplete = currentIndex + chunkSize >= fullContent.length
          }
        }),
      )

      currentIndex += chunkSize

      if (currentIndex >= fullContent.length) {
        clearInterval(chunkInterval)
        setIsChunkingActive(false)
        addMessage()
      }
    }, 16)
  }

  onMount(() => {
    setTimeout(addMessage, 500)
  })

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexGrow={1}>
      <scrollbox
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        focused
      >
        <For each={messages.data}>
          {(message) => (
            <box marginBottom={1}>
              <text>{message.role}: {message.content}</text>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}
```

---

## 7. Content Visibility & Performance

**Source**: [packages/solid/tests/scrollbox-content.test.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/tests/scrollbox-content.test.tsx)

### Viewport Culling

The `viewportCulling` option optimizes rendering by only rendering children that are visible in the viewport:

```tsx
<scrollbox
  viewportCulling={true}  // Only render visible items
  focused
  stickyScroll={true}
  stickyStart="bottom"
  flexGrow={1}
>
  <For each={messages()}>
    {(msg) => (
      <box marginTop={1} marginBottom={1}>
        <text>{msg}</text>
      </box>
    )}
  </For>
</scrollbox>
```

### Content with Code Blocks

ScrollBox handles complex content like syntax-highlighted code:

```tsx
<scrollbox
  ref={(r) => (scrollRef = r)}
  focused
  stickyScroll={true}
  stickyStart="bottom"
  flexGrow={1}
>
  <For each={messages()}>
    {(code) => (
      <box marginTop={2} marginBottom={2}>
        <code
          drawUnstyledText={false}
          syntaxStyle={syntaxStyle}
          content={code}
          filetype="markdown"
          treeSitterClient={mockTreeSitterClient}
        />
      </box>
    )}
  </For>
</scrollbox>
```

### Rapid Updates & Scrolling

ScrollBox maintains content visibility even with rapid updates:

```tsx
// Add 50 items rapidly
for (let i = 0; i < 50; i++) {
  setItems((prev) => [...prev, `Item ${i + 1}`])
}
await testSetup.renderOnce()

// Scroll to bottom
if (scrollRef) {
  scrollRef.scrollTo(scrollRef.scrollHeight)
  await testSetup.renderOnce()
}

// Content remains visible and properly rendered
const frame = testSetup.captureCharFrame()
expect(/Item \d+/.test(frame)).toBe(true)
```

---

## 8. Best Practices

### 1. Use `stickyScroll` for Chat/Log Applications
```tsx
<scrollbox stickyScroll={true} stickyStart="bottom" focused>
  {/* Messages or logs */}
</scrollbox>
```

### 2. Enable `viewportCulling` for Large Lists
```tsx
<scrollbox viewportCulling={true} focused>
  <For each={largeList()}>
    {(item) => <ItemComponent item={item} />}
  </For>
</scrollbox>
```

### 3. Use `ref` for Programmatic Control
```tsx
let scrollRef: ScrollBoxRenderable | undefined

<scrollbox ref={(r) => (scrollRef = r)} focused>
  {/* content */}
</scrollbox>

// Later
if (scrollRef) {
  scrollRef.scrollTo(scrollRef.scrollHeight)
}
```

### 4. Style Layers Independently
```tsx
<scrollbox
  style={{
    rootOptions: { backgroundColor: "#24283b", border: true },
    wrapperOptions: { backgroundColor: "#1f2335" },
    viewportOptions: { backgroundColor: "#1a1b26" },
    contentOptions: { backgroundColor: "#16161e" },
    scrollbarOptions: {
      showArrows: true,
      trackOptions: {
        foregroundColor: "#7aa2f7",
        backgroundColor: "#414868",
      },
    },
  }}
>
  {/* content */}
</scrollbox>
```

### 5. Use Appropriate Scroll Acceleration
```tsx
// For smooth, macOS-like scrolling
<scrollbox scrollAcceleration={new MacOSScrollAccel()} focused>
  {/* content */}
</scrollbox>

// For linear (no acceleration)
<scrollbox scrollAcceleration={new LinearScrollAccel()} focused>
  {/* content */}
</scrollbox>
```

### 6. Remember Solid.js Reactivity Rules
```tsx
// ✅ CORRECT: Call signals as functions
const items = createMemo(() => Array.from({ length: count() }, ...))

// ✅ CORRECT: Use For for objects, Index for primitives
<For each={objectItems()}>
  {(item) => <ItemComponent item={item} />}
</For>

// ✅ CORRECT: Read signal values in JSX
<text content={`Count: ${count()}`} />

// ❌ WRONG: Don't forget to call signals
<text content={`Count: ${count}`} />  // Won't update reactively
```

---

## 9. Component Registration

**Source**: [packages/solid/src/elements/index.ts#L93-L114](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/src/elements/index.ts#L93-L114)

ScrollBox is registered as a base component in OpenTUI:

```typescript
export const baseComponents = {
  box: BoxRenderable,
  text: TextRenderable,
  input: InputRenderable,
  select: SelectRenderable,
  textarea: TextareaRenderable,
  ascii_font: ASCIIFontRenderable,
  tab_select: TabSelectRenderable,
  scrollbox: ScrollBoxRenderable,  // ← ScrollBox component
  code: CodeRenderable,
  diff: DiffRenderable,
  line_number: LineNumberRenderable,
  // ... text modifiers
}
```

---

## 10. Related Files & Tests

| File | Purpose |
|------|---------|
| [packages/solid/examples/components/scroll-demo.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/examples/components/scroll-demo.tsx) | Basic scrollbox examples with For and Index |
| [packages/solid/examples/components/custom-scroll-accel-demo.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/examples/components/custom-scroll-accel-demo.tsx) | Custom scroll acceleration algorithms |
| [packages/solid/examples/session.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/examples/session.tsx) | Chat-like application with streaming messages |
| [packages/solid/tests/sticky-scroll.test.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/tests/sticky-scroll.test.tsx) | Sticky scroll behavior tests |
| [packages/solid/tests/scrollbox-content.test.tsx](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/solid/tests/scrollbox-content.test.tsx) | Content visibility and performance tests |
| [packages/core/src/renderables/ScrollBox.ts](https://github.com/sst/opentui/blob/e8c1233678e5d1660f9ea2d9e064bd4134454efb/packages/core/src/renderables/ScrollBox.ts) | Core ScrollBox implementation |

