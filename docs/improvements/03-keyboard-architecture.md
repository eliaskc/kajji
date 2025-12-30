# Keyboard Architecture

**Current**: Monolithic switch statement in `App.tsx` handles all keys globally.

## Option A: Per-Panel Handlers (Decentralized)

Each component handles its own keys when focused:

```typescript
function LogPanel() {
  const { isFocused } = useFocus("log")
  
  useKeyboard((evt) => {
    if (!isFocused()) return  // Ignore if not focused
    
    switch (evt.name) {
      case "j": selectNext(); break
      case "k": selectPrev(); break
      case "n": createNewChange(); break
    }
  })
}
```

**Pros**:
- Simple to understand - keys live next to the code they affect
- No coordination needed between components
- Easy to add panel-specific keys

**Cons**:
- Hard to see all keybindings at once
- No central place to show help/keybindings
- Can't easily build a command palette
- Duplicate boilerplate in each panel

**Best for**: Small apps, prototypes, when you don't need a help modal or command palette.

---

## Option B: Keymap Registry (Centralized)

Components register their keybindings with a central registry:

```typescript
// In KeymapProvider
const registry = new Map<string, KeyBinding>()

function registerKey(binding: KeyBinding) {
  const id = `${binding.context}:${binding.key}`
  registry.set(id, binding)
}

// Single global keyboard handler routes to registered actions
useKeyboard((evt) => {
  const context = getCurrentFocusContext()  // "log", "diff", etc.
  const binding = registry.get(`${context}:${evt.name}`)
  if (binding) binding.action()
})
```

```typescript
// In LogPanel
const { registerKey } = useKeymap()

onMount(() => {
  registerKey({ key: "j", context: "log", action: selectNext, description: "Next commit" })
  registerKey({ key: "k", context: "log", action: selectPrev, description: "Previous commit" })
  registerKey({ key: "n", context: "log", action: createNewChange, description: "New change" })
})
```

**Pros**:
- All keybindings discoverable in one place
- Trivial to build help modal (just list registry)
- Powers command palette (search registered commands)
- Consistent structure for all keybindings

**Cons**:
- More infrastructure to build upfront
- Keybindings separated from the code they affect
- Need to manage registration lifecycle (onMount/onCleanup)

**Best for**: Apps with help modals, command palettes, or many keybindings.

---

## Option C: Leader Key Pattern (Multi-Key Sequences)

A "leader" key (like Space or \) starts a sequence mode:

```typescript
const [leaderActive, setLeaderActive] = createSignal(false)
const [sequence, setSequence] = createSignal<string[]>([])

useKeyboard((evt) => {
  if (evt.name === " " && !leaderActive()) {
    setLeaderActive(true)
    return
  }
  
  if (leaderActive()) {
    setSequence(s => [...s, evt.name])
    
    // Check if sequence matches a command
    const seq = sequence().join("")
    if (seq === "rm") {  // leader → r → m
      rebaseToMain()
      reset()
    } else if (seq === "bp") {  // leader → b → p
      pushBookmark()
      reset()
    }
    // ... etc
  }
})
```

**Example sequences**:
- `<leader>n` - New change
- `<leader>rm` - Rebase to main
- `<leader>bp` - Push bookmark
- `<leader>gf` - Git fetch

**Pros**:
- Unlimited keybindings (no modifier key shortage)
- Feels like Vim (familiar to power users)
- Groups related commands (r = rebase, b = bookmark, g = git)

**Cons**:
- Steeper learning curve for new users
- Need to show "waiting for next key" state
- More complex to implement

**Best for**: Apps with many commands, power users, Vim users.

---

## Comparison

| Aspect | A: Per-Panel | B: Registry | C: Leader |
|--------|--------------|-------------|-----------|
| Complexity | Low | Medium | High |
| Discoverability | Poor | Great | Medium |
| Command palette | Hard | Easy | Easy |
| Help modal | Manual | Auto-generated | Auto-generated |
| Scalability | Limited | Good | Excellent |

## Recommendation

**Phase 1 (Now)**: Keep current monolithic approach - it works fine for ~20 keys

**Phase 2 (Command palette)**: Migrate to Option B
- Required for command palette functionality
- Enables auto-generated help modal

**Phase 3 (Optional)**: Add leader key on top of B
- Only if we run out of simple keybindings
- Can coexist with registry pattern

---

**Priority**: Medium effort | High impact | When adding command palette
