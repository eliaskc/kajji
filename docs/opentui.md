# OpenTUI Project Notes

> These are kajji-specific notes from issues we have encountered or patterns we have validated.
> Do not treat this as API reference. For current OpenTUI behavior, clone/update the source at `/tmp/opentui` and inspect it directly.

---

## Source Research

For current OpenTUI behavior, clone and inspect the source repo:

```bash
git clone https://github.com/sst/opentui /tmp/opentui
```

If `/tmp/opentui` already exists, update it before analysis. Release notes and docs pages are useful entry points, but verify behavior against source before making implementation decisions.

---

## Validated Patterns

### Spacer Elements & Virtualization

**Empty boxes require `flexShrink={0}`.**

When using `<box height={N}>` as a spacer element (for example, list virtualization), add `flexShrink={0}` or the box may collapse to 0 height in flex containers.

```tsx
// WRONG - may collapse in flex container
<box height={50} />

// CORRECT - maintains height
<box height={50} flexShrink={0} />
```

### Virtualization Spacers

For row virtualization in scrollable content, use explicit top and bottom spacers:

```tsx
<box flexDirection="column">
	<box height={visibleRange().start} flexShrink={0} />
	<For each={visibleRows()}>{(row) => <Row row={row} />}</For>
	<box height={totalRows - visibleRange().end} flexShrink={0} />
</box>
```

### ScrollBox Coordinates

Previously validated behavior:

- `scrollRef.scrollTop` returns a row index, not pixels
- `scrollRef.viewport?.height` returns number of visible rows
- `scrollRef.scrollTo(index)` scrolls to a row index

Re-check these against `/tmp/opentui` before touching scroll behavior, because scroll APIs have changed before.

### Focus-Based Key Routing

Components with a `focused` prop can handle their own keyboard events. Prefer parent-owned focus state and let focused child components handle local keys.

- **Global keys**: handle in root `useKeyboard`
- **Local keys**: route through focused component props when available

---

## Known Quirks

### Box Title Styling Limitation

`<box title="">` only accepts plain strings because titles are passed to the renderer. To style parts of a title differently, use the sibling overlay pattern — see [docs/PROJECT.md](./PROJECT.md#borderbox-pattern).

### Solid Signal Reading

Signals must be called as functions: `value()`, not `value`.

```tsx
// WRONG: <text>{value}</text>
// CORRECT: <text>{value()}</text>
```
