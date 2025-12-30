# Multi-Select Support

**Pattern from jjui**:

```typescript
interface SyncContextValue {
  // ... existing
  checkedItems: () => Set<string>     // Track multi-selected commits
  toggleChecked: (id: string) => void // Space to toggle
  clearChecked: () => void
}

// In LogPanel
<box backgroundColor={
  isSelected() ? theme.selection :
  isChecked() ? theme.selectionSecondary : 
  undefined
}>
```

## Use Cases

- Batch abandon
- Batch squash
- Batch rebase
- Batch operations on selected changes

## Implementation Notes

- Toggle with Space key
- Visual distinction between selected (focused) and checked (marked for batch operation)
- Need secondary background color in theme tokens

---

**Priority**: Medium effort | Medium impact | Post-MVP
