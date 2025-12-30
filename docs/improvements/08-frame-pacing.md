# Frame Pacing

**Pattern from jjui**:

Currently we render on every state change. For very fast navigation (holding j/k), this can cause CPU spikes.

## Implementation

```typescript
// Debounce renders to ~120 FPS (8ms)
let pendingRender = false
let lastRender = 0

function scheduleRender() {
  if (pendingRender) return
  const elapsed = Date.now() - lastRender
  if (elapsed >= 8) {
    render()
    lastRender = Date.now()
  } else {
    pendingRender = true
    setTimeout(() => {
      pendingRender = false
      render()
      lastRender = Date.now()
    }, 8 - elapsed)
  }
}
```

## Notes

- OpenTUI may handle this internally
- Profile actual performance before implementing
- Only implement if CPU usage becomes a problem during fast navigation

---

**Priority**: Low effort | Low impact | If performance issues arise
