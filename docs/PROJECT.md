# kajji Project Notes

> Design philosophy, architecture notes, and future ideas.
>
> **Work tracking:** [GitHub Project Board](https://github.com/eliaskc/kajji/projects)

---

## Design Philosophy

### AI/LLM Integration

**Healthy skepticism toward AI features.** Most AI integration requires entirely new UX flows and significantly inflates scope. kajji should stay focused on being an excellent jj TUI, not an AI-powered development assistant. Many dedicated tools already exist (aicommits, gptcommit, lumen, Claude Code, Copilot).

**Maybe in scope:** → [spec](./specs/ai-integration.md)
- Commit message generation from diff (like [lumen](https://github.com/jnsahaj/lumen)) — low-friction, well-defined

**Out of scope:**
- Explain changes (revision → file → hunk) — too much UX investment
- Hunk selection for AI queries — requires custom diff renderer first
- AI-assisted jj actions — external agents (Claude Code, etc.) do this better
- AI-assisted PR review — only reconsider if PR management lands AND there's clear value

### PR Management Scope

PR management beyond comment sync is out of scope for now — the risk is becoming an "everything TUI" that overlaps too much with existing tools. Archived exploration: `~/oh-yeah/Projects/kajji/archive/pr-management.md`.

**Covered by Code Review plan:**
- PR comment sync (read-only) for addressing feedback locally
- Inline comment UI shared with local review

**Not yet planned (evaluate if there's demand):**
- PR list view (open, assigned, review requested)
- PR actions: approve, request changes, merge
- GitHub file sync (track viewed files)
- Full review submission workflow

---

## Architecture Notes

### BorderBox Pattern

OpenTUI's `<box title="">` only accepts plain strings (passed to Zig renderer). To style parts of the title differently (e.g., highlight active tab), use the sibling overlay pattern:

```tsx
<box position="relative">
  <box position="absolute" top={0} left={2} zIndex={1}>
    <text>
      <span style={{ fg: activeColor }}>[active]</span>
      <span style={{ fg: dimColor }}> | inactive</span>
    </text>
  </box>
  <box border>{children}</box>
</box>
```

**Design idea — `BorderBox` wrapper with corner slots:**

```tsx
<BorderBox
  topLeft={<><span style={{ fg: accent }}>[1]</span>─Log | Oplog</>}
  topRight={<text>3 files</text>}
  bottomLeft={<text>hints</text>}
  bottomRight={<text>100%</text>}
  border
  borderColor={...}
>
  {children}
</BorderBox>
```

Each corner prop accepts `JSX.Element | string`. Internally wraps content in `position="relative"` box with absolutely positioned overlays at each corner. Passes through all standard `<box>` props (border, borderColor, etc.).

### Confirmation Flag Patterns

jj commands that modify history require confirmation flags. Two patterns:

1. **Modal with flag toggles** (rebase, squash, bookmark move) — target picker opens first, flags shown as toggles in modal. Use when: operation requires user input before we know if flag is needed.

2. **Upfront confirmation** (describe, abandon on immutable) — detect condition before opening modal, show confirmation dialog first. Use when: we can check the condition immediately (e.g., is this commit immutable?).

---

## Future Ideas

Longer-term possibilities, not actively planned:

- Command mode autocomplete
- Conflict visualization
- Interactive rebase UI
- Bookmark filtering by author (show only bookmarks I've touched)

### GitHub PR Stacking

> "Graphite in a TUI" — stacked PRs with jj's clean model, open-source and free.

See [spec](./specs/github-stacking.md) for the full design.

**Key concepts:**
- Log-centric approach: multi-select commits → create stack
- Visual stack editor: rename bookmarks, toggle draft/ready per-PR
- Stack reconciliation: detect merged PRs, one-keypress fix

---

## Reference

- **Specs:** [`docs/specs/`](./specs/) — Active specs for unimplemented features
- **Vault archive:** `~/oh-yeah/Projects/kajji/archive/` — Completed/superseded specs
- **Vault references:** `~/oh-yeah/Projects/kajji/references/` — Tool analysis, research

**External inspiration:**
- [lumen](https://github.com/jnsahaj/lumen) — Rust CLI: beautiful side-by-side diff viewer, AI commit messages. Clone to `/tmp/lumen` and inspect source directly when researching patterns.
