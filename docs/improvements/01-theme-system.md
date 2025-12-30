# Theme System Evolution

**Current state**: Hardcoded hex colors scattered across components.

## Phase 1: Simple Token File (MVP)

```
src/theme/
├── colors.ts      # Semantic token constants
└── index.ts       # Re-export
```

```typescript
// colors.ts - Single dark theme, no runtime switching
export const colors = {
  borderFocused: "#4ECDC4",
  borderDefault: "#444444",
  selectionBg: "#283457",
  textPrimary: "#c0caf5",
  textMuted: "#565f89",
  textAccent: "#7aa2f7",
  textAuthor: "#e0af68",
  textTimestamp: "#9ece6a",
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
} as const
```

**Benefits**: Zero runtime overhead, simple imports, catches all hardcoded colors.

## Phase 2: Theme Context (Post-MVP)

When users request light mode or custom themes:

```
src/theme/
├── colors.ts         # Token type definitions
├── themes/
│   ├── tokyo-night.ts
│   ├── catppuccin.ts
│   └── system.ts     # Generated from terminal palette
├── context.tsx       # ThemeProvider + useTheme hook
└── index.ts
```

```typescript
// context.tsx
interface Theme {
  name: string
  colors: ThemeColors
}

const ThemeContext = createContext<Theme>()

export function ThemeProvider(props: { children: JSX.Element }) {
  const [theme, setTheme] = createSignal<Theme>(tokyoNight)
  
  // Optional: Detect light/dark from terminal via OSC 11
  onMount(async () => {
    const isDark = await detectTerminalBackground()
    if (!isDark) setTheme(lightTheme)
  })
  
  return (
    <ThemeContext.Provider value={theme()}>
      {props.children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be within ThemeProvider")
  return ctx
}
```

```typescript
// Usage in components
const theme = useTheme()
<box borderColor={theme.colors.borderFocused} />
```

## Phase 3: Terminal-Aware System Theme (Optional)

Pattern from opencode - query terminal for its palette:

```typescript
// Query terminal background color via OSC 11
async function detectTerminalBackground(): Promise<boolean> {
  // Send: \x1b]11;?\x07
  // Parse response to get background color
  // Return true if dark (luminance < 0.5)
}

// Generate theme from terminal's 16-color palette
function generateSystemTheme(palette: TerminalPalette): Theme {
  return {
    name: "system",
    colors: {
      borderFocused: palette.cyan,
      textPrimary: palette.foreground,
      // ... map palette to semantic tokens
    }
  }
}
```

**When to implement**: When users report theme clashes with their terminal.

---

**Priority**: Low (Phase 1 done) | Medium effort (Phase 2-3) | High impact
