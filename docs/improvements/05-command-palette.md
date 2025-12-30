# Command Palette

**Pattern from opencode**:

```typescript
// Components register commands
const { registerCommand } = useCommand()

onMount(() => {
  registerCommand({
    id: "change.new",
    label: "New Change",
    shortcut: "n",
    action: () => createNewChange()
  })
})

// Palette searches all registered commands
<CommandPalette trigger="ctrl+p" />
```

## Benefits

- Searchable commands
- Self-documenting keybindings
- Powers help modal
- Discoverability for users

## Implementation Notes

- Requires keyboard registry (see `03-keyboard-architecture.md`)
- Should support fuzzy search with `<select>` component
- Can reuse command metadata in help modal

---

**Priority**: High effort | High impact | Post-MVP
